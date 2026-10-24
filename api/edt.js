// Handler Vercel /api/edt : validation des entrées, réponse HTTP.
// Toute la logique CELCAT (login LDAP, scraping, parsing) vit dans lib/celcat.js.
import { getAuthenticatedEvents } from '../lib/celcat.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-celcat-user, x-celcat-pass');

    if (req.method === 'OPTIONS') return res.status(200).end();

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
                message: "CELCAT n'a retourné aucun cours : l'ID étudiant (fid0) ou le CID du groupe dans les paramètres de la PWA est probablement incorrect.",
                events: []
            });
        }

        return res.status(200).json({
            success: true,
            source: 'celcat_uvsq',
            student: 'Tounga Nana, Adriel Kynan',
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
