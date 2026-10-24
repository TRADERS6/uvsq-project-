// Handler Vercel /api/edt : validation des entrées, réponse HTTP.
// Toute la logique CELCAT (login LDAP, scraping, parsing) vit dans lib/celcat.js.
//
// Durcissement (opt-in via variables d'environnement Vercel) :
//   ALLOWED_ORIGIN    = https://mon-edt.vercel.app  → CORS restreint à la PWA ;
//                       à défaut, '*' (comportement historique, sans secret exposé).
//   RATE_LIMIT_BURST  = capacité de rafale par IP (défaut 60)
//   RATE_LIMIT_PER_SEC= recharge par seconde par IP (défaut 2)
// Le limiter est en mémoire par instance (lib/rate-limit.js) : suffisant contre
// les floods ; pour un comptage global exact, prévoir Redis (p. ex. Upstash).
// Le widget Scriptable n'est pas un navigateur : le CORS ne le bloque pas.
import { getAuthenticatedEvents } from '../lib/celcat.js';
import { rateLimit } from '../lib/rate-limit.js';

// Lu à chaque requête (et non à l'import) : le comportement suit les
// variables d'environnement courantes, testable et resistant aux soft-launch.
const allowedOrigin = () => process.env.ALLOWED_ORIGIN || '';

function setCors(res) {
    const origin = allowedOrigin();
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-celcat-user, x-celcat-pass');
    if (origin) res.setHeader('Vary', 'Origin');
}

function clientIp(headers) {
    return String(headers['x-real-ip'] || String(headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown');
}

export default async function handler(req, res) {
    setCors(res);

    if (req.method === 'OPTIONS') return res.status(200).end();

    // Rate-limit par IP (bucket de jetons), avant tout le reste : cheap
    const limiter = rateLimit(`edt:${clientIp(req.headers)}`, {
        burst: Number(process.env.RATE_LIMIT_BURST || 60),
        refillPerSec: Number(process.env.RATE_LIMIT_PER_SEC || 2)
    });
    if (!limiter.allowed) {
        res.setHeader('Retry-After', String(limiter.retryAfterSec));
        return res.status(429).json({
            success: false,
            error: 'rate_limited',
            message: `Trop de requêtes depuis cet appareil : nouvelle tentative dans ${limiter.retryAfterSec} s.`,
            events: []
        });
    }

    // Identifiants : env Vercel en priorité, sinon headers transmis par la PWA
    const user = process.env.CELCAT_USERNAME || req.headers['x-celcat-user'] || '';
    const pass = process.env.CELCAT_PASSWORD || req.headers['x-celcat-pass'] || '';

    if (!user || !pass) {
        // Info utile à l'onboarding de la PWA : le serveur dispose-t-il déjà
        // d'identifiants propre ? Sinon, chaque étudiant doit mettre les siens.
        return res.status(401).json({
            success: false,
            error: 'missing_credentials',
            server_credentials_configured: !!process.env.CELCAT_USERNAME && !!process.env.CELCAT_PASSWORD,
            message: "Identifiants UVSQ absents : définissez CELCAT_USERNAME / CELCAT_PASSWORD dans Vercel, ou renseignez-les dans les paramètres de la PWA.",
            events: []
        });
    }

    const studentId = String(req.query.id || '22609743').replace(/[^0-9]/g, '');
    const cidParam = req.query.cid || process.env.CELCAT_CID || '-1742253826;1073733534;175432540;108';

    try {
        const events = await getAuthenticatedEvents(user, pass, studentId, cidParam);

        if (events.length === 0) {
            return res.status(200).json({
                success: false,
                error: 'no_events',
                message: "CELCAT n'a retourné aucun cours : le compte ENT ou l'ID étudiant dans les paramètres de la PWA est probablement incorrect.",
                events: []
            });
        }

        // Mode widget (Scriptable iOS) : réponse compacte — le prochain cours +
        // la journée, sans les détails bruts ni la liste complète de l'année.
        if (req.query.widget) {
            // start/end sont des instants UTC (voir toParisInstant dans lib/celcat.js) :
            // les comparaisons server-side sont donc justes indépendamment du TZ du serveur.
            const now = Date.now();
            const upcoming = events
                .map(e => ({ start: e.start, end: e.end, title: e.title, type: e.type, room: e.room, prof: e.prof }))
                .filter(e => new Date(e.end).getTime() > now)
                .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
            const todayKey = new Date().toISOString().slice(0, 10);
            const isToday = e => new Date(e.start).toISOString().slice(0, 10) === todayKey;

            return res.status(200).json({
                success: true,
                source: 'celcat_uvsq',
                widget: true,
                now: new Date().toISOString(),
                next: upcoming[0] || null,
                today: upcoming.filter(isToday)
            });
        }

        return res.status(200).json({
            success: true,
            source: 'celcat_uvsq',
            student: studentId,
            group: 'GMP1S1TP4',
            count: events.length,
            fetchedAt: new Date().toISOString(),
            events
        });
    } catch (error) {
        const kind = error.kind || 'unknown';

        if (kind === 'bad_credentials') {
            return res.status(401).json({
                success: false,
                error: 'bad_credentials',
                message: 'Login ou mot de passe UVSQ refusé par CELCAT (LDAP).',
                events: []
            });
        }
        if (kind === 'captcha') {
            return res.status(502).json({
                success: false,
                error: 'captcha_required',
                message: "UVSQ a déclenché un captcha (trop d'échecs de connexion). Reconnectez-vous une fois via un navigateur, puis réessayez.",
                events: []
            });
        }

        return res.status(502).json({
            success: false,
            error: kind,
            message: error.message,
            events: []
        });
    }
}
