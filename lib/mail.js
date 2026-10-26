// Logique Messagerie Partage pour la PWA UVSQ.
// D'après la doc officielle UVSQ (https://www.uvsq.fr/comment-consulter-vos-messages) :
//   IMAP  / entrant  : partage.uvsq.fr : 993 SSL/TLS
//   SMTP / sortant : partage.uvsq.fr : 465 SSL/TLS
//   login : l'adresse mail UVSQ, mot de passe du compte UVSQ
// Lecture via imapflow, envoi via nodemailer. Toute la logique vit ici ;
// api/mail.js fait juste validation / mise en forme des réponses HTTP,
// comme lib/celcat.js le fait pour l'EDT.
//
// Choix persistants :
//   - lecture uniquement : un mail lu n'est JAMAIS supprimé, seulement marqué
//     \Seen (comme n'importe quel client mail) ;
//   - jamais de HTML renvoyé au front : on extrait le texte brut côté serveur
//     (le contenu d'un mail est non fiable, XSS interdit par construction) ;
//   - si l'identifiant n'est pas une adresse e-mail, on devine l'adresse
//     d'expédition de l'étudiant à partir des destinataires des derniers mails
//     (Partage accepte des logins LDAP non e-mail).
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';

const IMAP_HOST = 'partage.uvsq.fr';
const SMTP_HOST = 'partage.uvsq.fr';
const TIMEOUT = 15000; // connexion/lecture : rapide, format serverless

// ---------- aides ----------

function normalizeAddresses(value) {
    if (!value) return [];
    return value.filter(a => a && a.address).map(a => ({
        name: a.name || '',
        address: String(a.address || '').trim()
    }));
}

// auth IMAP/SMTP refusée → kind 'bad_credentials' pour une 401 propre
function wrapError(error, fallbackKind = 'mail_error') {
    const text = String(error.message || error.responseText || error);
    if (/AUTH|invalid credentials|login|password/i.test(text)) {
        const e = new Error('Identifiants refusés par la messagerie UVSQ. Le login attendu par Partage est ton adresse mail UVSQ (ex : prenom.nom@etu.uvsq.fr) — vérifie-le avec ton mot de passe UVSQ dans les paramètres, ou réinitialise ton mot de passe par SESAME si trop ancien.');
        e.kind = 'bad_credentials';
        return e;
    }
    error.kind = error.kind || fallbackKind;
    return error;
}

// Partage attend officiellement le login « adresse mail UVSQ ». Si
// l'étudiant n'a saisi qu'un numéro étudiant, on essaie automatiquement les
// extensions plausibles (numéro@etu.uvsq.fr, numéro@uvsq.fr) — seulement en
// cas d'échec d'authentification, jamais de suppression, mmême mot de passe.
// Si aucun n'est accepté (adresses réellement basées sur prenom.nom), le 401
// final explique d'entrer l'adresse mail complète.
function loginCandidates(raw) {
    const u = String(raw || '').trim();
    const list = [u];
    if (u && !u.includes('@')) list.push(`${u}@etu.uvsq.fr`, `${u}@uvsq.fr`);
    return [...new Set(list)];
}

// Une vraie erreur d'authentification justifie d'essayer le candidat suivant ;
// un problème réseau/certificat n'a aucun bon candidat possible : on stoppe.
function isAuthError(error) {
    const text = String(error.message || error.responseText || '');
    return /AUTH|password|invalid credentials|credentials/i.test(text)
        && !/ENOTFOUND|ECONN|ETIMEDOUT|CERT|DEEP_TIME|self-signed/i.test(text);
}

async function connectImap(login, pass) {
    const client = new ImapFlow({
        host: IMAP_HOST,
        port: 993,
        secure: true,
        auth: { user: login, pass },
        logger: false,
        connectionTimeout: TIMEOUT,
        greetingTimeout: TIMEOUT,
        socketTimeout: 60000
    });
    try {
        await client.connect();
        return client;
    } catch (error) {
        try { client.close(); } catch (e) { /* pas encore connecté */ }
        throw error;
    }
}

// ---------- dossiers IMAP ----------
// Les noms réels varient selon la configuration du compte Partage
// ("Sent", "Eléments envoyés", "Junk", "Corbeille"…). On découvre les
// dossiers à chaque connexion : les attributs spéciaux IMAP (\Sent, \Junk,
// \Trash) font foi, avec un repli sur le nom quand le serveur ne les expose
// pas. La réception reste toujours 'INBOX' — id standard IMAP.
const FOLDER_TARGETS = {
    sent: { special: '\\Sent', hints: /sent|envoy/i },
    junk: { special: '\\Junk', hints: /junk|spam|indésir|indesir/i },
    trash: { special: '\\Trash', hints: /trash|corbei|poubelle|deleted/i },
    archive: { special: '\\Archive', hints: /archive|archiv/i }
};

// Retourne les chemins réels des dossiers disponibles : { inbox, sent?, junk?, trash? }
async function discoverFolders(client) {
    const paths = { inbox: 'INBOX' };
    try {
        const nodes = await client.list();
        for (const node of nodes || []) {
            if (!node || !node.path) continue;
            for (const [id, target] of Object.entries(FOLDER_TARGETS)) {
                if (paths[id]) continue;
                const special = String(node.specialUse || '').toLowerCase();
                if (special === target.special.toLowerCase() || target.hints.test(String(node.name || ''))) {
                    paths[id] = node.path;
                }
            }
        }
    } catch (e) {
        /* LIST indisponible : on ne propose que la boîte de réception */
    }
    return paths;
}

// Exécute fn(client, login, paths) sur le premier candidat de login accepté.
// La connexion est verrouillée sur le dossier demandé (inbox par défaut).
// Le login gagnant est attaché au résultat (result.login) ainsi que les
// dossiers disponibles (result.folders) : l'API les renvoie, la PWA s'en
// souvient et réutilise directement le bon format.
async function withImap(user, pass, fn, wantedFolder = 'inbox') {
    const candidates = loginCandidates(user);
    let lastError = null;

    for (const candidate of candidates) {
        let client;
        try {
            client = await connectImap(candidate, pass);
        } catch (error) {
            lastError = error;
            if (isAuthError(error)) continue; // candidat suivant
            throw wrapError(error);           // réseau/certificat : inutile d'insister
        }
        try {
            const paths = await discoverFolders(client);
            if (paths[wantedFolder] === undefined) {
                const e = new Error(`Dossier « ${wantedFolder} » indisponible sur ce compte Partage.`);
                e.kind = 'no_such_folder';
                throw e;
            }
            const lock = await client.getMailboxLock(paths[wantedFolder]);
            try {
                const result = await fn(client, candidate, paths);
                if (result && typeof result === 'object') {
                    result.login = candidate;
                    result.folders = Object.keys(paths);
                }
                return result;
            } finally {
                lock.release();
            }
        } catch (error) {
            if (error && error.kind === 'no_such_folder') throw error; // indépendant du login
            throw wrapError(error); // connecté : les erreurs suivantes ne changent pas le login
        } finally {
            try { client.close(); } catch (e) { /* socket déjà fermée */ }
        }
    }

    throw wrapError(lastError); // tous les candidats refusés → 401 parlant
}

// HTML brut d'un mail → texte lisible (anti-XSS : le front n'affiche que du texte)
function htmlToText(html) {
    return String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// ---------- lecture ----------

// Trouve la première partie texte lisible (préfère text/plain, retombe
// sur text/html), en ignorant les pièces jointes nommées.
function findTextPart(node, found) {
    found = found || { plain: null, html: null };
    if (node) {
        const isAttachment = node.disposition && node.disposition.type === 'attachment';
        if (!isAttachment) {
            if (node.type === 'text/plain' && !found.plain) found.plain = node;
            else if (node.type === 'text/html' && !found.html) found.html = node;
        }
        for (const child of node.childNodes || []) findTextPart(child, found);
    }
    return found.plain || found.html;
}

// Extrait de la première partie texte (~4 Ko demandés au serveur via la
// requête partielle BODY[part<4000>]). imapflow décode transfert + charset ;
// on coupe les entêtes d'un message non-multipart et les whitespace.
async function buildPreview(client, uid, bodyStructure) {
    try {
        const node = findTextPart(bodyStructure);
        const download = await client.download(String(uid), node && node.part ? node.part : true, { uid: true, maxBytes: 4000 });
        const chunks = [];
        for await (const chunk of download.content) chunks.push(chunk);

        let text = Buffer.concat(chunks).toString('utf8');
        if (!node || !node.part) {
            // Tout le message : on saute les entêtes (séparateur double CRLF)
            const sep = Math.max(text.indexOf('\r\n\r\n'), text.indexOf('\n\n'));
            if (sep > 0) text = text.slice(sep + (text[sep] === '\r' ? 4 : 2));
        }
        if (node && node.type === 'text/html') text = htmlToText(text);
        return text.replace(/\s+/g, ' ').trim().slice(0, 220);
    } catch (e) {
        return ''; // aperçu faculatif : jamais bloquant pour la liste
    }
}

// GET /api/mail : les `limit` mails les plus récents du dossier demandé
// (inbox, sent, junk ou trash — chemins réels découverts par withImap)
export async function listRecentMails(user, pass, limit = 15, folder = 'inbox') {
    return withImap(user, pass, async (client) => {
        const total = client.mailbox && client.mailbox.exists ? client.mailbox.exists : 0;
        const start = Math.max(1, total - limit + 1);
        const mails = [];

        const fetches = client.fetch(`${start}:*`, { uid: true, envelope: true, flags: true, bodyStructure: true });
        for await (const msg of fetches) {
            if (!msg || !msg.envelope) continue;
            const env = msg.envelope;
            const from = normalizeAddresses(env.from)[0] || null;
            mails.push({
                uid: msg.uid,
                subject: env.subject || '(Sans objet)',
                from,
                to: normalizeAddresses(env.to),
                date: env.date ? new Date(env.date).toISOString() : null,
                unread: !msg.flags || !msg.flags.has('\\Seen'),
                structure: msg.bodyStructure // réutilisée pour l'aperçu
            });
        }

        const recent = mails
            .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
            .slice(0, limit);
        // fetch() consommé : les mails sont triés, on récupère leurs aperçus
        // hors de la boucle (une requête partielle BODY[part<~12 Ko] chacun)
        for (const mail of recent) {
            mail.preview = await buildPreview(client, mail.uid, mail.structure);
            delete mail.structure; // interne : jamais renvoyé au front
        }
        return { mails: recent }; // le login gagnant est attaché par withImap
    });
}

// GET /api/mail?uid=N : un mail complet du dossier demandé, texte brut,
// marqué « lu ». Le uid est propre à CHAQUE dossier IMAP : la lecture doit
// ouvrir exactement le dossier affiché dans la liste.
// Décodage minimal des entêtes encodées RFC 2047 (=?utf-8?B?…?=) — sert
// aux noms de pièces jointes venant de la BODYSTRUCTURE, sans dépendance en plus.
function decodeHeaderValue(value) {
    return String(value || '')
        .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (full, charset, enc, data) => {
            try {
                const latin = /iso-8859|windows-12|latin/i.test(charset);
                if (enc.toLowerCase() === 'b') {
                    const buf = Buffer.from(data, 'base64');
                    return buf.toString(latin ? 'latin1' : 'utf8');
                }
                const buf = Buffer.from(
                    data.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))),
                    'binary'
                );
                return buf.toString(latin ? 'latin1' : 'utf8');
            } catch (e) {
                return full; // nom illisible : on le laisse brut
            }
        })
        .replace(/\s+/g, ' ')
        .trim();
}

// Parcourt la BODYSTRUCTURE et récupère les vraies pièces jointes avec leur
// numéro de part IMAP (indispensable pour le téléchargement ?part=).
// Trois formes réelles de serveurs (dont Partage) :
//   1. disposition "attachment" (classique) ;
//   2. disposition "inline" MAIS avec un filename ;
//   3. AUCUNE disposition (NIL) mais un nom et un type non texte
//      (application/pdf, image/…) — c'est alors une pièce jointe.
// Utilisable par les tests : exporté volontairement.
export function collectAttachmentParts(node, out = []) {
    if (!node) return out;
    const type = String(node.type || '').toLowerCase();
    const isAttachment =
        (node.disposition && String(node.disposition).toLowerCase() === 'attachment') ||
        !!(node.dispositionParameters && node.dispositionParameters.filename) ||
        !!(node.parameters && node.parameters.name && type && !/^(text\/plain|text\/html|multipart)/.test(type));
    if (isAttachment) {
        const rawName = (node.dispositionParameters && node.dispositionParameters.filename)
            || (node.parameters && node.parameters.name)
            || '';
        out.push({
            // Une pièce jointe à la racine (message non multipart) est le part 1 IMAP
            part: node.part || '1',
            name: decodeHeaderValue(rawName) || 'pièce-jointe',
            type: node.type || 'application/octet-stream',
            size: node.size || null
        });
    }
    for (const child of node.childNodes || []) collectAttachmentParts(child, out);
    return out;
}

export async function getMail(user, pass, uid, folder = 'inbox') {
    const uidNum = Number(uid);
    if (!Number.isInteger(uidNum) || uidNum <= 0) {
        const e = new Error('Identifiant de message invalide.');
        e.kind = 'validation';
        throw e;
    }

    return withImap(user, pass, async (client) => {
        const info = await client.fetchOne(String(uidNum), { uid: true, source: true, bodyStructure: true }, { uid: true });
        if (!info) {
            const e = new Error('Message introuvable (déjà lu et déplacé ou supprimé ?).');
            e.kind = 'no_such_mail';
            throw e;
        }
        const parsed = await simpleParser(info.source);

        // Marquer \Seen : lecture = lu, comme sur un vrai client (jamais de suppression)
        try { await client.messageFlagsAdd(String(uidNum), ['\\Seen'], { uid: true }); } catch (e) { /* non bloquant */ }

        return {
            mail: {
                uid: uidNum,
                subject: parsed.subject || '(Sans objet)',
                from: normalizeAddresses(parsed.from.data ? parsed.from.data.value : [])[0] || null,
                to: normalizeAddresses(parsed.to && parsed.to.value),
                cc: normalizeAddresses(parsed.cc && parsed.cc.value),
                date: (parsed.date ? new Date(parsed.date) : null)?.toISOString(),
                text: (parsed.text || htmlToText(parsed.html) || '').slice(0, 200000),
                // Pièces jointes avec numéro de part IMAP (téléchargeables via
                // ?part=) ; structure absente → repli simpleParser (non téléchargeable)
                attachments: (info.bodyStructure ? collectAttachmentParts(info.bodyStructure)
                    : (parsed.attachments || []).map(a => ({ part: null, name: a.filename || 'pièce-jointe', type: a.contentType || '', size: null })))
            }
        };
    }, folder);
}

// GET /api/mail?uid=N&part=P : le contenu d'une pièce jointe, en base64.
// Cap : les réponses des fonctions serverless sont plafonnées (~4,5 Mo)
// → 3 Mo de binaire env. ; au-delà, erreur parlante vers le webmail.
const ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;

export async function getAttachment(user, pass, uid, folder = 'inbox', part) {
    const uidNum = Number(uid);
    if (!Number.isInteger(uidNum) || uidNum <= 0) {
        const e = new Error('Identifiant de message invalide.');
        e.kind = 'validation';
        throw e;
    }
    const partId = String(part || '').trim();
    if (!/^\d+(\.\d+)*$/.test(partId)) {
        const e = new Error('Numéro de pièce jointe invalide.');
        e.kind = 'validation';
        throw e;
    }

    return withImap(user, pass, async (client) => {
        const download = await client.download(String(uidNum), partId, { uid: true, maxBytes: ATTACHMENT_MAX_BYTES });
        const chunks = [];
        for await (const chunk of download.content) chunks.push(chunk);
        const buf = Buffer.concat(chunks);
        if (buf.length >= ATTACHMENT_MAX_BYTES) {
            const e = new Error('Pièce jointe trop grosse pour la PWA (> 3 Mo) : ouvre-la via le webmail Partage de l\'UVSQ (Web Access).');
            e.kind = 'attachment_too_big';
            throw e;
        }
        return { attachment: { content: buf.toString('base64') } };
    }, folder);
}

// ---------- actions sur un mail (corbeille, déplacement) ----------

// Validation partagée : le uid est un entier positif, le dossier une
// cible IMAP connue (inbox, sent, junk, trash, archive).
const KNOWN_FOLDERS = ['inbox', 'sent', 'junk', 'trash', 'archive'];

function checkMutationArgs(uid, folder) {
    const uidNum = Number(uid);
    if (!Number.isInteger(uidNum) || uidNum <= 0) {
        const e = new Error('Identifiant de message invalide.');
        e.kind = 'validation';
        throw e;
    }
    if (!KNOWN_FOLDERS.includes(folder)) {
        const e = new Error('Dossier de départ inconnu.');
        e.kind = 'validation';
        throw e;
    }
    return uidNum;
}

// Suppression : la Corbeille du compte est préférée quand elle existe
// (déplacement \Trash, comme un vrai client mail) ; sinon \Deleted + expunge.
// Aucune suppression définitive immédiate : on ne vide jamais la corbeille.
export async function deleteMail(user, pass, uid, folder = 'inbox') {
    const uidNum = checkMutationArgs(uid, folder);

    return withImap(user, pass, async (client, login, paths) => {
        if (paths.trash && paths.trash !== paths[folder]) {
            await client.messageMove(String(uidNum), paths.trash, { uid: true });
            return { action: 'deleted', where: 'trashed', target: paths.trash };
        }
        await client.messageDelete(String(uidNum), { uid: true });
        return { action: 'deleted', where: 'marked', target: null };
    }, folder);
}

// Déplacement vers un autre dossier connu du compte.
export async function moveMail(user, pass, uid, fromFolder = 'inbox', targetFolder = 'trash') {
    const uidNum = checkMutationArgs(uid, fromFolder);
    if (!KNOWN_FOLDERS.includes(targetFolder)) {
        const e = new Error('Dossier de destination inconnu.');
        e.kind = 'validation';
        throw e;
    }
    if (targetFolder === fromFolder) {
        const e = new Error('Le mail est déjà dans ce dossier.');
        e.kind = 'validation';
        throw e;
    }

    return withImap(user, pass, async (client, login, paths) => {
        const dest = paths[targetFolder];
        if (!dest) {
            const e = new Error(`Dossier « ${targetFolder} » indisponible sur ce compte Partage.`);
            e.kind = 'no_such_folder';
            throw e;
        }
        await client.messageMove(String(uidNum), dest, { uid: true });
        return { action: 'moved', where: 'moved', target: dest };
    }, fromFolder);
}

// Archivage façon Gmail : le mail quitte la réception SANS passer par la
// corbeille — il reste consultable dans le dossier « Archives ». Le dossier
// \Archive du compte est utilisé s'il existe, sinon « Archives » est créé
// automatiquement au premier archivage (création best-effort, une fois).
export async function archiveMail(user, pass, uid, folder = 'inbox') {
    const uidNum = checkMutationArgs(uid, folder);
    if (folder === 'archive') {
        const e = new Error('Le mail est déjà archivé.');
        e.kind = 'validation';
        throw e;
    }

    return withImap(user, pass, async (client, login, paths) => {
        let dest = paths.archive;
        if (!dest) {
            // Première utilisation : création du dossier « Archives »
            try {
                const created = await client.mailboxCreate('Archives');
                dest = (created && (created.path || created.mailboxPath)) || 'Archives';
            } catch (e) {
                // ALREADYEXISTS (créé entre-temps) : on retente le déplacement vers ce nom
                dest = 'Archives';
            }
        }
        await client.messageMove(String(uidNum), dest, { uid: true });
        return { action: 'archived', where: 'archived', target: dest };
    }, folder);
}

// ---------- envoi ----------

// Adresse d'expédition : le login accepté par le serveur EST l'adresse du
// compte. Fallback pour le cas improbable d'un login numérique accepté.
function fromAddress(login, rawUser) {
    if (login && login.includes('@')) return login;
    return `${String(rawUser).trim()}@etu.uvsq.fr`;
}

// POST /api/mail : envoi via SMTP 465 SSL
export async function sendMessage(user, pass, mail) {
    const recipients = String(mail.to || '')
        .split(/[,;]/)
        .map(a => a.trim())
        .filter(Boolean);

    if (recipients.length === 0) {
        const e = new Error('Destinataire manquant : indique au moins une adresse e-mail.');
        e.kind = 'validation';
        throw e;
    }
    const bad = recipients.find(a => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
    if (bad) {
        const e = new Error(`Adresse invalide : « ${bad} ».`);
        e.kind = 'validation';
        throw e;
    }
    const text = String(mail.text || '').trim();
    if (!text) {
        const e = new Error('Le message est vide.');
        e.kind = 'validation';
        throw e;
    }
    if (String(mail.subject || '').length > 300 || text.length > 200000 || recipients.length > 20) {
        const e = new Error('Message trop volumineux (sujet 300 car. max, 20 destinataires max).');
        e.kind = 'validation';
        throw e;
    }

    // Candidats de login identiques à l'IMAP : le premier accepté par le
    // serveur SMTP gagne, le From utilise alors la vraie adresse du compte.
    let lastError = null;
    for (const candidate of loginCandidates(user)) {
        const transport = nodemailer.createTransport({
            host: SMTP_HOST,
            port: 465,
            secure: true,
            auth: { user: candidate, pass },
            connectionTimeout: TIMEOUT,
            greetingTimeout: TIMEOUT,
            socketTimeout: 60000
        });
        try {            const info = await transport.sendMail({
                from: fromAddress(candidate, user),
                to: recipients,
                subject: String(mail.subject || '').trim(),
                text
            });

            // Le SMTP ne classe pas l'envoi dans « Éléments envoyés » : on y
            // dépose une copie (comme le fait un vrai client mail), best-effort —
            // un échec de copie n'invalide JAMAIS l'envoi lui-même.
            try {
                const raw = info && info.message ? info.message : null;
                if (raw) {
                    await withImap(candidate, pass, async (client, login, paths) => {
                        if (paths.sent) {
                            await client.append(paths.sent, raw, { flags: ['\\Seen'] });
                        }
                    }, 'inbox');
                }
            } catch (e) { /* copie non bloquante */ }

            return { from: fromAddress(candidate, user), to: recipients, messageId: info.messageId, login: candidate };

        } catch (error) {
            lastError = error;
            if (isAuthError(error)) continue; // candidat suivant
            throw wrapError(error, 'smtp_error');
        }
    }
    throw wrapError(lastError, 'smtp_error');
}
