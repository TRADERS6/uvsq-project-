// Logique CELCAT UVSQ : login LDAP, récupération et parsing des événements.
// Extrait tel quel de api/edt.js lors du refactor — aucun changement de
// comportement ; seule la frontière avec le handler Vercel est redessinée.
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
export const BASE = 'https://edt.uvsq.fr';

// Cache de session en mémoire (par instance warm) : ~25 min
const sessionCache = new Map();
const SESSION_TTL = 25 * 60 * 1000;

export async function getAuthenticatedEvents(user, pass, studentId, cidParam) {
    const cacheKey = `${user.toLowerCase()}|${studentId}|${cidParam}`;
    const cached = sessionCache.get(cacheKey);
    if (cached && Date.now() < cached.expires) {
        try {
            const events = await fetchEvents(cached.jar, studentId, cidParam);
            if (events.parsed.length > 0) return events.parsed;
        } catch (_) {
            // Session tombée entre le cache et la requête (302 du fallback
            // GetCalendarData) : on NE remonte PAS un bad_credentials faux.
            // Cache périmé → login frais ci-dessous, réponse honnête.
        }
        sessionCache.delete(cacheKey);
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
export function extractEventArray(html, keyName) {
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
export function normalizeEvent(item, idx) {
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
        start: toParisInstant(start),
        end: toParisInstant(end),
        group: groupLines.join(' / '),
        title: (subjectLine || roomLines[0] || lines[0] || 'Cours GMP').replace(/\s*\[[A-Z0-9]{3,9}\]\s*$/, ''),
        type: extractCourseType(category || kindLine || lines.join(' ')),
        room: roomLines.join(' / ') || 'Salle N/A',
        prof: profLines.join('/') || 'Enseignant UVSQ',
        rawDetails: lines
    };
}

// Les horaires CELCAT sont "naïfs" : l'heure murale de Paris, sans fuseau.
// La PWA interprète ce format côté téléphone (locale de Paris → correct),
// mais tout calcul serveur (compte à rebours du widget, fenêtres) et tout
// étudiant à l'étranger ont besoin de l'instant UTC réel.
// Conversion : hypothèse de départ "naïf = UTC", puis deux itérations avec
// l'offset réel de Europe/Paris à cette date (CET +1 / CEST +2, via Intl).
function tzOffsetMs(at) {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Paris', hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const parts = {};
    for (const p of dtf.formatToParts(at)) parts[p.type] = p.value;
    const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, parts.hour === '24' ? 0 : +parts.hour, +parts.minute, +parts.second);
    return wall - at.getTime();
}

function toParisInstant(naive) {
    if (typeof naive !== 'string') return naive;
    if (/Z$|[+-]\d{2}:?(?:\d{2})?$/.test(naive)) return naive; // déjà qualifié en temps
    if (typeof Intl === 'undefined') return naive; // environnement sans Intl : inchangé
    try {
        const normalized = naive.replace(' ', 'T');
        let utc = Date.parse(normalized + 'Z');
        if (Number.isNaN(utc)) return naive;
        for (let i = 0; i < 2; i++) {
            utc = Date.parse(normalized + 'Z') - tzOffsetMs(new Date(utc));
        }
        return new Date(utc).toISOString();
    } catch (_) {
        return naive;
    }
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
