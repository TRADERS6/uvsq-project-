// Handler Vercel /api/mail : validation des entrées, réponse HTTP.
// Toute la logique Partage (IMAP lecture, SMTP envoi) vit dans lib/mail.js.
//
// Identifiants : env Vercel MAIL_USERNAME / MAIL_PASSWORD en priorité, sinon
// headers transmis par la PWA (x-mail-user / x-mail-pass), à l'image de
// CELCAT_USERNAME dans api/edt.js.
//
// Durcissement : même CORS optionnel (ALLOWED_ORIGIN) et même rate-limit
// (RATE_LIMIT_BURST / RATE_LIMIT_PER_SEC) que /api/edt, compteur séparé « mail: ».
import { listRecentMails, getMail, sendMessage, deleteMail, moveMail, archiveMail } from '../lib/mail.js';
import { rateLimit } from '../lib/rate-limit.js';

const allowedOrigin = () => process.env.ALLOWED_ORIGIN || '';

// Dossiers IMAP acceptés côté front : inbox toujours, sent/junk/trash selon
// la découverte sur le compte (noms réels résolus dans lib/mail.js)
const FOLDER_WHITELIST = ['inbox', 'sent', 'junk', 'trash', 'archive'];

function setCors(res) {
    const origin = allowedOrigin();
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-mail-user, x-mail-pass');
    if (origin) res.setHeader('Vary', 'Origin');
}

function clientIp(headers) {
    return String(headers['x-real-ip'] || String(headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown');
}

function respondError(res, status, error, extra = {}) {
    return res.status(status).json({
        success: false,
        error: error.kind || 'unknown',
        message: error.message,
        ...extra
    });
}

async function readJson(req) {
    try {
        if (typeof req.body === 'object' && req.body !== null) return req.body;
        const raw = typeof req.body === 'string' ? req.body : await new Promise((resolve, reject) => {
            let data = '';
            req.on('data', c => { data += c; if (data.length > 500000) reject(new Error('body too large')); });
            req.on('end', () => resolve(data));
            req.on('error', reject);
        });
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return null;
    }
}

function getCredentials(req) {
    return {
        user: process.env.MAIL_USERNAME || req.headers['x-mail-user'] || '',
        pass: process.env.MAIL_PASSWORD || req.headers['x-mail-pass'] || ''
    };
}

export default async function handler(req, res) {
    setCors(res);

    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'method_not_allowed', message: 'Méthode non autorisée (GET ou POST uniquement).' });
    }

    // Rate-limit par IP, bucket indépendant de l'EDT (l'IMAP est coûteux)
    const limiter = rateLimit(`mail:${clientIp(req.headers)}`, {
        burst: Number(process.env.RATE_LIMIT_BURST || 60),
        refillPerSec: Number(process.env.RATE_LIMIT_PER_SEC || 2)
    });
    if (!limiter.allowed) {
        res.setHeader('Retry-After', String(limiter.retryAfterSec));
        return res.status(429).json({
            success: false,
            error: 'rate_limited',
            message: `Trop de requêtes depuis cet appareil : nouvelle tentative dans ${limiter.retryAfterSec} s.`
        });
    }

    const { user, pass } = getCredentials(req);
    if (!user || !pass) {
        return res.status(401).json({
            success: false,
            error: 'missing_credentials',
            server_credentials_configured: !!process.env.MAIL_USERNAME && !!process.env.MAIL_PASSWORD,
            message: "Identifiants ENT absents : renseigne-les dans les paramètres de la PWA — la même connexion sert à l'emploi du temps et à la messagerie."
        });
    }

    try {
        // ---------- GET : liste des derniers mails, ou lecture d'un mail ----------
        if (req.method === 'GET') {
            // ?folder=inbox|sent|junk|trash (inbox par défaut) : chaque dossier
            // est une vraie boîte IMAP ouverte côté serveur
            const folder = String(req.query.folder || 'inbox').toLowerCase();
            if (!FOLDER_WHITELIST.includes(folder)) {
                return res.status(400).json({
                    success: false,
                    error: 'bad_request',
                    message: 'Dossier inconnu : inbox, sent, junk ou trash.'
                });
            }

            const uidQuery = req.query.uid;
            if (uidQuery) {
                // Le uid est propre au dossier : lecture de la boîte affichée
                const r = await getMail(user, pass, uidQuery, folder);
                return res.status(200).json({
                    success: true,
                    source: 'partage_imap',
                    folder,
                    login: r.login, // format de login accepté (front le mémorise)
                    mail: r.mail
                });
            }

            let limit = Number.parseInt(req.query.limit, 10);
            if (!Number.isFinite(limit)) limit = 15;
            limit = Math.min(50, Math.max(1, limit));
            const r = await listRecentMails(user, pass, limit, folder);
            return res.status(200).json({
                success: true,
                source: 'partage_imap',
                folder,
                login: r.login,
                folders: r.folders || ['inbox'], // dossiers découverts sur le compte
                count: r.mails.length,
                fetchedAt: new Date().toISOString(),
                mails: r.mails
            });
        }

        // ---------- POST ----------
        const body = await readJson(req);
        if (!body || typeof body !== 'object') {
            return res.status(400).json({ success: false, error: 'bad_request', message: 'Corps de requête JSON invalide.' });
        }

        // ------ action sur un mail existant : supprimer / déplacer / archiver ------
        if (body.action === 'delete' || body.action === 'move' || body.action === 'archive') {
            const folder = String(body.folder || 'inbox').toLowerCase();
            const target = String(body.target || 'trash').toLowerCase();
            if (!FOLDER_WHITELIST.includes(folder) || (body.action === 'move' && !FOLDER_WHITELIST.includes(target))) {
                return res.status(400).json({ success: false, error: 'bad_request', message: 'Dossier inconnu : inbox, sent, junk, trash ou archive.' });
            }
            const r = body.action === 'delete'
                ? await deleteMail(user, pass, body.uid, folder)
                : body.action === 'archive'
                    ? await archiveMail(user, pass, body.uid, folder)
                    : await moveMail(user, pass, body.uid, folder, target);
            return res.status(200).json({
                success: true,
                source: 'partage_imap',
                folder,
                login: r.login,
                where: r.where,
                message: body.action === 'delete'
                    ? 'Mail déplacé dans la corbeille Partage.'
                    : body.action === 'archive'
                        ? 'Mail archivé (dossier « Archives »).'
                        : `Mail déplacé vers « ${target} ».`
            });
        }

        // ------ envoi d'un e-mail via SMTP ------
        const result = await sendMessage(user, pass, body);
        return res.status(200).json({
            success: true,
            source: 'partage_smtp',
            login: result.login,
            message: `Message envoyé à ${result.to.join(', ')}.`,
            from: result.from,
            messageId: result.messageId
        });
    } catch (error) {
        const kind = error.kind || 'unknown';

        if (kind === 'missing_credentials') return respondError(res, 401, error);
        if (kind === 'bad_credentials') return respondError(res, 401, error);
        if (kind === 'validation') return respondError(res, 400, error);
        if (kind === 'no_such_mail') return respondError(res, 404, error);
        if (kind === 'no_such_folder') return respondError(res, 404, error);

        return respondError(res, 502, error);
    }
}
