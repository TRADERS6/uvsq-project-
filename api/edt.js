export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-celcat-user, x-celcat-pass');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // Identifiants : env Vercel en priorité, sinon headers transmis par la PWA
    const user = process.env.CELCAT_USERNAME || req.headers['x-celcat-user'] || '';
    const pass = process.env.CELCAT_PASSWORD || req.headers['x-celcat-pass'] || '';

    if (!user || !pass) {
        return res.status(401).json({
            success: false,
            error: 'missing_credentials',
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

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BASE = 'https://edt.uvsq.fr';

// Cache de session en mémoire (par instance warm) : ~25 min
const sessionCache = new Map();
const SESSION_TTL = 25 * 60 * 1000;

async function getAuthenticatedEvents(user, pass, studentId, cidParam) {
    const cacheKey = `${user.toLowerCase()}|${studentId}|${cidParam}`;
    const cached = sessionCache.get(cacheKey);
    if (cached && Date.now() < cached.expires) {
        const events = await fetchEvents(cached.jar, studentId, cidParam);
        if (events.parsed.length > 0) return events.parsed;
    }

    const jar = await doLdapLogin(user, pass);
    const events = await fetchEvents(jar, studentId, cidParam);

    if (events.parsed.length > 0) {
        sessionCache.set(cacheKey, { jar, expires: Date.now() + SESSION_TTL });
        return events.parsed;
    }

    if (FormFieldPresence(events.lastHtml)) {
        const err = new Error('La session CELCAT a été invalidée juste après le login.');
        err.kind = 'bad_credentials';
        throw err;
    }

    return events.parsed;
}

function FormFieldPresence(html) {
    return typeof html === 'string' && html.includes('/LdapLogin/Logon');
}

function CaptchaWidgetPresent(html) {
    return /data-sitekey|g-recaptcha|recaptcha_challenge|ctCaptcha/i.test(html);
}

function FilledBadCaptcha(html) {
    return /field-validation-error[^>]*data-valmsg-for="BadCaptcha"[^>]*>\s*[^<]+/i.test(html);
}

// ---- Étape 1 : GET /Login pour cookies + jeton anti-forgery ----
async function doLdapLogin(user, pass) {
    // Jar partagé entre GET et POST : le cookie .AspNetCore.Antiforgery
    // capté sur /LdapLogin doit accompagner le POST, sinon 400.
    const jar = {};
    const loginUrl = `${BASE}/Login`;
    const page = await followRedirects(loginUrl, {
        jar,
        headers: {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    });

    const loginHtml = await page.res.text();
    const tokenMatch = loginHtml.match(/__RequestVerificationToken[^>]*?value="([^"]+)"/);
    if (!tokenMatch) {
        if (CaptchaWidgetPresent(loginHtml)) {
            const err = new Error('Captcha exigé par UVSQ au moment du login.');
            err.kind = 'captcha';
            throw err;
        }
        const err = new Error('Jeton anti-forgery introuvable sur la page /Login.');
        err.kind = 'login_page_unreachable';
        throw err;
    }

    // ---- Étape 2 : POST /LdapLogin/Logon (sans suivre : succès = 302) ----
    const body = new URLSearchParams({
        Name: user,
        Password: pass,
        RememberMe: 'true',
        __RequestVerificationToken: tokenMatch[1]
    });

    const post = await followRedirects(`${BASE}/LdapLogin/Logon`, {
        jar,
        method: 'POST',
        maxHops: 0, // ne pas suivre : le 302 EST le signal de succès
        headers: {
            'User-Agent': UA,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Referer': page.finalUrl,
            'Origin': BASE
        },
        body: body.toString()
    });

    if (post.status !== 302 && post.status !== 303) {
        return classifyLoginFailure(post);
    }

    return post.jar;
}

async function classifyLoginFailure(post) {
    const postHtml = await post.res.text();
    // Nb mesuré : la page de login contient toujours des spans vides "BadCaptcha"/"WrongCredentials" ;
    // l'échec se voit au formulaire re-servi ; le captcha réel n'apparaît qu'avec un widget g-recaptcha/data-sitekey.
    if (CaptchaWidgetPresent(postHtml) || FilledBadCaptcha(postHtml)) {
        const err = new Error('Captcha UVSQ déclenché au moment du login.');
        err.kind = 'captcha';
        throw err;
    }
    const err = new Error('CELCAT a refusé les identifiants LDAP (formulaire de connexion encore affiché).');
    err.kind = 'bad_credentials';
    throw err;
}

// ---- Étape 3 : GET /cal authentifié, fallback POST /Home/GetCalendarData ----
async function fetchEvents(jar, studentId, cidParam) {
    const now = new Date();
    // Fenêtre = année universitaire complète (septembre -> août suivants),
    // pour couvrir tous les mois affichables dans la PWA (passé comme futur de l'année en cours)
    const acYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1; // 8 = septembre
    const startDate = fmtDate(acYear, 8);      // 1er septembre de l'année universitaire
    const endDate = fmtDate(acYear + 1, 7);    // 1er août de l'année suivante

    const calUrl = `${BASE}/cal?vt=month&dt=${startDate}&et=student&cid=${encodeURIComponent(cidParam)}&fid0=${studentId}`;

    const cal = await followRedirects(calUrl, {
        jar,
        headers: {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Referer': `${BASE}/`
        }
    });

    const calHtml = await cal.res.text();

    // 1) L'objet "events" injecté dans le HTML par CELCAT (balancier de crochets)
    let events = extractEventArray(calHtml, 'events');

    // 2) Fallback : POST /Home/GetCalendarData avec la session active
    if (events.length === 0) {
        const form = new URLSearchParams({
            start: startDate,
            end: endDate,
            resType: '104',
            calView: 'month',
            'federationIds[]': studentId,
            colourScheme: '3'
        });

        const post = await followRedirects(`${BASE}/Home/GetCalendarData`, {
            jar,
            method: 'POST',
            maxHops: 0,
            headers: {
                'User-Agent': UA,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': cal.finalUrl,
                'Origin': BASE
            },
            body: form.toString()
        }).catch(() => null);

        if (post) {
            if ([302, 303].includes(post.status)) {
                // Redirection vers /LdapLogin : session morte
                const err = new Error('Session CELCAT invalidée pendant la récupération des données.');
                err.kind = 'bad_credentials';
                throw err;
            }
            if (post.status < 400) {
                const text = await post.res.text();
                try {
                    const json = JSON.parse(text);
                    if (Array.isArray(json)) events = json;
                    else if (Array.isArray(json.events)) events = json.events;
                    else if (Array.isArray(json.data)) events = json.data;
                } catch (_) { /* réponse non JSON : on abandonne ce fallback proprement */ }
            }
        }
    }

    return { parsed: events.map(normalizeEvent).filter(Boolean), lastHtml: calHtml };
}

// Suivi de redirection manuel : Set-Cookie capturé à CHAQUE saut (undici ne
// remonte que ceux de la réponse finale quand il suit en interne).
async function followRedirects(url, options) {
    const { jar = {}, maxHops = 5, ...rest } = options;
    let currentUrl = url;

    for (let hop = 0; ; hop++) {
        const headers = { ...rest.headers };
        const cookieHeader = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
        if (cookieHeader) headers['Cookie'] = cookieHeader;

        const res = await fetch(currentUrl, { ...rest, headers, redirect: 'manual', signal: AbortSignal.timeout(20000) });

        const setCookies = (typeof res.headers.getSetCookie === 'function')
            ? res.headers.getSetCookie()
            : [res.headers.get('set-cookie')].filter(Boolean);
        for (const raw of setCookies) {
            const [pair] = raw.split(';');
            const idx = pair.indexOf('=');
            if (idx > 0) jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
        }

        const location = res.headers.get('location');
        const isRedirect = [301, 302, 303, 307, 308].includes(res.status);
        if (!isRedirect || !location || hop >= maxHops) {
            return { res, jar, finalUrl: currentUrl, status: res.status };
        }

        if (res.status === 303 && rest.method === 'POST') {
            delete rest.body;
            rest.method = 'GET';
        }
        currentUrl = new URL(location, currentUrl).toString();
    }
}

function fmtDate(year, month) {
    const d = new Date(year, month, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// Premier "[" après la clé "events", puis extraction de l'array complet
function extractEventArray(html, keyName) {
    if (typeof html !== 'string') return [];
    const re = new RegExp(`(?:var\\s+|const\\s+|let\\s+|"?${keyName}"?\\s*[:=]\\s*)(\\[)`, 'i');
    const m = html.match(re);
    if (!m) return [];

    const start = html.indexOf('[', html.indexOf(m[0]));
    if (start === -1) return [];

    let depth = 0, inString = false, quote = '', escaped = false;
    for (let i = start; i < html.length; i++) {
        const ch = html[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === quote) inString = false;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') { inString = true; quote = ch; continue; }
        if (ch === '[') depth++;
        else if (ch === ']') {
            depth--;
            if (depth === 0) {
                const raw = html.slice(start, i + 1);
                try {
                    const parsed = JSON.parse(raw);
                    return Array.isArray(parsed) ? parsed.filter(it => it && typeof it === 'object') : [];
                } catch (_) {
                    return [];
                }
            }
        }
    }
    return [];
}

// Normalisation d'un événement CELCAT -> format PWA
// Structure mesurée des cellules (vrais cours UVSQ) :
//   [DS TD|TD|TP|CM 150] | [GMP1S1xxx [GMP1S1xxx]] | [salle(s)] | [matière CODE ... [CODE]] | [Nom, Prénom]
function normalizeEvent(item, idx) {
    const pick = (...keys) => {
        for (const k of keys) {
            const v = k.split('.').reduce((o, p) => (o && o[p] !== undefined ? o[p] : undefined), item);
            if (v) return v;
        }
        return '';
    };

    const start = pick('Start', 'start', 'StartDateTime', 'StartsAt', 'startDT');
    const end = pick('End', 'end', 'EndDateTime', 'EndsAt', 'endDT');
    if (!start || !end) return null;

    const rawTitle = pick('Title', 'title', 'Description', 'description', 'Tooltip', 'tooltip');
    const lines = String(rawTitle)
        .split(/<br\s*\/?\s*>|\r?\n/)
        .map(l => decodeEntities(l.replace(/<[^>]*>/g, '')).trim())
        .filter(Boolean);

    const category = pick('Category', 'category').toString().toUpperCase();
    const isKind = l => /^(DS|TD|TP|CM|EXAM(?:EN)?|SAE)\b/i.test(l);
    const isGroup = l => /^GMP\d/i.test(l);
    const isProf = l => /^[A-Za-zÀ-ÿ][^,]{1,60},\s*[A-Za-zÀ-ÿ]/.test(l);
    const isSubject = l => /\[[A-Z0-9]{3,9}\]\s*$/.test(l);

    const kindLine = lines.find(isKind) || '';
    const groupLines = lines.filter(isGroup);
    const profLines = lines.filter(l => isProf(l) && !isGroup(l));
    const subjectLine = lines.find(l => isSubject(l) && !isGroup(l) && !isProf(l));

    const taken = new Set([kindLine, subjectLine, ...groupLines, ...profLines]);
    const roomLines = lines.filter(l => !taken.has(l) && !isKind(l) && !isGroup(l) && !isProf(l) && !isSubject(l));

    return {
        id: String(pick('Id', 'id', 'EventId', 'eventId') || `evt-${idx}`),
        start,
        end,
        group: groupLines.join(' / '),
        title: (subjectLine || roomLines[0] || lines[0] || 'Cours GMP').replace(/\s*\[[A-Z0-9]{3,9}\]\s*$/, ''),
        type: extractCourseType(category || kindLine || lines.join(' ')),
        room: roomLines.join(' / ') || 'Salle N/A',
        prof: profLines.join('/') || 'Enseignant UVSQ',
        rawDetails: lines
    };
}

function decodeEntities(s) {
    return s
        .replace(/&#(\d+);/g, (_, d) => {
            try { return String.fromCodePoint(Number(d)); } catch (_) { return _; }
        })
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
            try { return String.fromCodePoint(parseInt(h, 16)); } catch (_) { return _; }
        })
        .replace(/&amp;/g, '&');
}

function extractCourseType(text) {
    if (/\b(SAE|S\.A\.E)\b/i.test(text)) return 'SAE';
    if (/\bEXAM|EXAMEN\b/i.test(text)) return 'EXAM';
    if (/\bTP\b/i.test(text)) return 'TP';
    if (/\bTD\b/i.test(text)) return 'TD';
    if (/\bCM\b/i.test(text)) return 'CM';
    return 'TP';
}
