// Harnais de fumée API : exécute les VRAIS handlers Vercel avec req/res
// simulés. Uniquement des chemins sans réseau (validations), pour vérifier
// qu'aucune erreur de contrat ne ferait planter une requête réelle.
import edtHandler from './api/edt.js';
import mailHandler from './api/mail.js';
import { buckets } from './lib/rate-limit.js';

let pass = 0, fail = 0;
function makeRes() {
    const res = { statusCode: null, body: null, headers: {} };
    res.status = (s) => { res.statusCode = s; return res; };
    res.setHeader = (k, v) => { res.headers[k] = v; return res; };
    res.json = (o) => { res.body = o; return res; };
    res.end = () => { res.body = res.body ?? ''; return res; };
    return res;
}

async function expect(label, promise, wantStatus, wantError) {
    try {
        const res = await promise;
        const ok = res.statusCode === wantStatus
            && (wantError === undefined ? true : res.body && res.body.error === wantError);
        if (ok) { console.log(`PASS ${label} → ${res.statusCode}${wantError ? '/' + res.body.error : ''}`); pass++; }
        else { console.log(`FAIL ${label} → statut ${res.statusCode}, body=${JSON.stringify(res.body)}`); fail++; }
    } catch (e) {
        console.log(`FAIL ${label} : exception ${e.message}`);
        fail++;
    }
}

const CREDS = { 'x-celcat-user': 'etu@etu.uvsq.fr', 'x-celcat-pass': 'pw', 'x-mail-user': 'etu@etu.uvsq.fr', 'x-mail-pass': 'pw', 'x-real-ip': 'smoke-ip' };

// ---------- 1. OPTIONS (CORS préflight) : doit répondre 200 vide ----------
await expect('edt OPTIONS → 200', edtHandler({ method: 'OPTIONS', query: {}, headers: {} }, makeRes()), 200);
await expect('mail OPTIONS → 200', mailHandler({ method: 'OPTIONS', query: {}, headers: {} }, makeRes()), 200);

// ---------- 2. Méthodes non supportées ----------
await expect('edt PUT → 405', edtHandler({ method: 'PUT', query: {}, headers: {} }, makeRes()), 405);
await expect('mail DELETE → 405', mailHandler({ method: 'DELETE', query: {}, headers: {} }, makeRes()), 405);

// ---------- 3. Identifiants absents → 401 explicite ----------
await expect('edt GET sans creds → 401 missing_credentials',
    edtHandler({ method: 'GET', query: {}, headers: {} }, makeRes()), 401, 'missing_credentials');
await expect('mail GET sans creds → 401 missing_credentials',
    mailHandler({ method: 'GET', query: {}, headers: {} }, makeRes()), 401, 'missing_credentials');
// et la PWA doit savoir si le serveur a ses propres creds (info onboarding)
{
    const res = makeRes();
    await mailHandler({ method: 'GET', query: {}, headers: {} }, res);
    if (res.body && res.body.server_credentials_configured === false) { console.log('PASS mail 401 expose server_credentials_configured=false'); pass++; }
    else { console.log('FAIL mail 401 sans server_credentials_configured'); fail++; }
}

// ---------- 4. Validations sans réseau (creds présents) ----------
// Dossier inconnu → 400, AVANT toute connexion IMAP
await expect('mail GET ?folder=bogus → 400 bad_request',
    mailHandler({ method: 'GET', query: { folder: 'bogus' }, headers: CREDS }, makeRes()), 400, 'bad_request');
// uid non entier → 400 validation
await expect('mail GET ?uid=abc → 400 validation',
    mailHandler({ method: 'GET', query: { uid: 'abc' }, headers: CREDS }, makeRes()), 400, 'validation');
// part non numérique → 400 validation (uid valide, part = "1..x")
await expect('mail GET ?uid=1&part=x → 400 validation',
    mailHandler({ method: 'GET', query: { uid: '1', folder: 'inbox', part: 'x' }, headers: CREDS }, makeRes()), 400, 'validation');
// POST corps invalide → 400 bad_request
{
    const req = { method: 'POST', headers: CREDS, body: 'not json' }; // readJson attend objet callable... string → JSON.parse échoue → null
    await expect('mail POST corps cassé → 400 bad_request', mailHandler(req, makeRes()), 400, 'bad_request');
}
// POST action=delete sans uid → 400 validation, sans réseau
await expect('mail POST delete sans uid → 400 validation',
    mailHandler({ method: 'POST', headers: CREDS, body: { action: 'delete', folder: 'inbox' } }, makeRes()), 400, 'validation');
// POST action=move vers dossier inconnu → 400 bad_request
await expect('mail POST move target=bogus → 400 bad_request',
    mailHandler({ method: 'POST', headers: CREDS, body: { action: 'move', uid: 1, folder: 'inbox', target: 'bogus' } }, makeRes()), 400, 'bad_request');
// POST action=archive depuis archive → 400 validation ("déjà archivé"), sans réseau
await expect('mail POST archive depuis archive → 400 validation',
    mailHandler({ method: 'POST', headers: CREDS, body: { action: 'archive', uid: 1, folder: 'archive' } }, makeRes()), 400, 'validation');
// Garde-fou (uid, dossier) : un déplacement SOURCE == DESTINATION ferait un
// couple incohérent (mail encore ouvert depuis le dossier précédent) → 400 validation
await expect('mail POST move target==folder → 400 validation',
    mailHandler({ method: 'POST', headers: CREDS, body: { action: 'move', uid: 1, folder: 'inbox', target: 'inbox' } }, makeRes()), 400, 'validation');
// un déplacement DEPUIS un dossier non whitelisté → 400 bad_request
await expect('mail POST move depuis folder=bogus → 400 bad_request',
    mailHandler({ method: 'POST', headers: CREDS, body: { action: 'move', uid: 1, folder: 'bogus', target: 'trash' } }, makeRes()), 400, 'bad_request');
// une suppression depuis un dossier non whitelisté → 400 bad_request
await expect('mail POST delete folder=bogus → 400 bad_request',
    mailHandler({ method: 'POST', headers: CREDS, body: { action: 'delete', uid: 1, folder: 'bogus' } }, makeRes()), 400, 'bad_request');
// POST envoi sans corps utile → 400 validation (destinataire manquant)
await expect('mail POST send sans to → 400 validation',
    mailHandler({ method: 'POST', headers: CREDS, body: { subject: 'x', text: 'y' } }, makeRes()), 400, 'validation');

// ---------- 5. Rate-limit : burst atteint → 429 avec Retry-After ----------
{
    process.env.RATE_LIMIT_BURST = '2';
    process.env.RATE_LIMIT_PER_SEC = '0.0001';
    const ip = { 'x-real-ip': 'flood-ip' };
    buckets.clear(); // socle propre pour ce test isolé
    for (let i = 0; i < 2; i++) {
        await mailHandler({ method: 'GET', query: {}, headers: ip }, makeRes());
    }
    const res = makeRes();
    await mailHandler({ method: 'GET', query: {}, headers: ip }, res);
    if (res.statusCode === 429 && res.body.error === 'rate_limited' && res.headers['Retry-After']) {
        console.log(`PASS rate-limit 429 + Retry-After=${res.headers['Retry-After']}s`); pass++;
    } else {
        console.log(`FAIL rate-limit → ${res.statusCode}, body=${JSON.stringify(res.body)}`); fail++;
    }
    delete process.env.RATE_LIMIT_BURST; delete process.env.RATE_LIMIT_PER_SEC;
    buckets.clear();
}

// ---------- 6. CORS : origine autorisée quand ALLOWED_ORIGIN est défini ----------
{
    process.env.ALLOWED_ORIGIN = 'https://uvsq-project.vercel.app';
    const res = makeRes();
    await mailHandler({ method: 'OPTIONS', query: {}, headers: {} }, res);
    if (res.headers['Access-Control-Allow-Origin'] === 'https://uvsq-project.vercel.app' && res.headers['Vary'] === 'Origin') {
        console.log('PASS CORS restreint + Vary: Origin'); pass++;
    } else {
        console.log(`FAIL CORS → ${JSON.stringify(res.headers)}`); fail++;
    }
    delete process.env.ALLOWED_ORIGIN;
}

console.log(`\nRésultat : ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
