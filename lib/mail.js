// Logique Messagerie Partage (mail.partage.renater.fr) pour la PWA UVSQ.
// Lecture IMAP (port 993 SSL, via imapflow) et envoi SMTP (port 465 SSL, via
// nodemailer). Toute la logique vit ici ; api/mail.js fait juste validation /
// mise en forme des réponses HTTP, comme lib/celcat.js le fait pour l'EDT.
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

const IMAP_HOST = 'mail.partage.renater.fr';
const SMTP_HOST = 'mail.partage.renater.fr';
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
        const e = new Error('Identifiants ENT refusés par le serveur de messagerie Partage. Vérifie le login et le mot de passe dans les paramètres (l\'ENT sert aussi aux e-mails).');
        e.kind = 'bad_credentials';
        return e;
    }
    error.kind = error.kind || fallbackKind;
    return error;
}

async function withImap(user, pass, fn) {
    const client = new ImapFlow({
        host: IMAP_HOST,
        port: 993,
        secure: true,
        auth: { user, pass },
        logger: false,
        connectionTimeout: TIMEOUT,
        greetingTimeout: TIMEOUT,
        socketTimeout: 60000
    });
    try {
        await client.connect();
        const lock = await client.getMailboxLock('INBOX');
        try {
            return await fn(client);
        } finally {
            lock.release();
        }
    } catch (error) {
        throw wrapError(error);
    } finally {
        try { client.close(); } catch (e) { /* socket déjà fermée */ }
    }
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

// GET /api/mail : les `limit` mails les plus récents de INBOX
export async function listRecentMails(user, pass, limit = 15) {
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
        return recent;
    });
}

// GET /api/mail?uid=N : un mail complet, en texte brut, marqué « lu »
export async function getMail(user, pass, uid) {
    const uidNum = Number(uid);
    if (!Number.isInteger(uidNum) || uidNum <= 0) {
        const e = new Error('Identifiant de message invalide.');
        e.kind = 'validation';
        throw e;
    }

    return withImap(user, pass, async (client) => {
        const raw = await client.fetchOne(String(uidNum), { uid: true, source: true }, { uid: true });
        if (!raw) {
            const e = new Error('Message introuvable (déjà lu et déplacé ou supprimé ?).');
            e.kind = 'no_such_mail';
            throw e;
        }
        const parsed = await simpleParser(raw.source);

        // Marquer \Seen : lecture = lu, comme sur un vrai client (jamais de suppression)
        try { await client.messageFlagsAdd(String(uidNum), ['\\Seen'], { uid: true }); } catch (e) { /* non bloquant */ }

        return {
            uid: uidNum,
            subject: parsed.subject || '(Sans objet)',
            from: normalizeAddresses(parsed.from.data ? parsed.from.data.value : [])[0] || null,
            to: normalizeAddresses(parsed.to && parsed.to.value),
            cc: normalizeAddresses(parsed.cc && parsed.cc.value),
            date: (parsed.date ? new Date(parsed.date) : null)?.toISOString(),
            text: (parsed.text || htmlToText(parsed.html) || '').slice(0, 200000),
            attachments: (parsed.attachments || []).map(a => ({ name: a.filename || 'pièce-jointe', type: a.contentType || '' }))
        };
    });
}

// ---------- envoi ----------

// Adresse d'expédition la plus plausible : celle que l'étudiant voit le plus
// souvent dans les destinataires de sa boîte (partie locale Partage != e-mail).
function guessOwnAddress(mails) {
    const counts = new Map();
    for (const mail of mails || []) {
        for (const dest of (mail.to || []).concat(mail.cc || [])) {
            const addr = String(dest.address || '').toLowerCase().trim();
            if (!addr || !addr.includes('@')) continue;
            counts.set(addr, (counts.get(addr) || 0) + 1);
        }
    }
    let best = null, bestCount = 0;
    for (const [addr, count] of counts) {
        if (count > bestCount) { best = addr; bestCount = count; }
    }
    return best;
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

    // From : identifiant e-mail → direct ; sinon déduit des mails récents ;
    // en dernier recours, domaine étudiant Partage UVSQ.
    let from = user.includes('@') ? user : '';
    if (!from) {
        try {
            const recent = await listRecentMails(user, pass, 15);
            from = guessOwnAddress(recent) || '';
        } catch (e) { /* l'envoi reste possible, le SMTP utilisera l'utilisateur */
        }
    }
    if (!from) from = `${user}@etu.uvsq.fr`;

    const transport = nodemailer.createTransport({
        host: SMTP_HOST,
        port: 465,
        secure: true,
        auth: { user, pass },
        connectionTimeout: TIMEOUT,
        greetingTimeout: TIMEOUT,
        socketTimeout: 60000
    });

    try {
        const info = await transport.sendMail({
            from,
            to: recipients,
            subject: String(mail.subject || '').trim(),
            text
        });
        return { from, to: recipients, messageId: info.messageId };
    } catch (error) {
        throw wrapError(error, 'smtp_error');
    }
}
