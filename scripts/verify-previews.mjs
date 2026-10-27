// Sonde de production : vérifie les APERÇUS RÉELS servis par Vercel.
//
// Appelle l'API déployée comme la PWA (mêmes headers), compte les caractères
// de remplacement U+FFFD (« � ») dans chaque aperçu de liste et dans le corps
// du lecteur, par dossier. L'objectif du fix récent (255b363, 43085c1,
// f046655) est : zéro « � » dans les aperçus des mails accentués.
//
// AUCUN identifiant dans ce fichier : on lit les variables d'environnement.
// Utilisation (dans ton terminal, repo local) :
//   MAIL_USER="ton-adresse@etu.uvsq.fr" MAIL_PASS="ton-mot-de-passe" node scripts/verify-previews.mjs
// Sortie : PASS si aucun « � » détecté, avec la liste détaillée par mail.
const BASE = process.env.BASE_URL || 'https://uvsq-project.vercel.app';
const user = process.env.MAIL_USER || '';
const pass = process.env.MAIL_PASS || '';

if (!user || !pass) {
    console.error('Usage : MAIL_USER="..." MAIL_PASS="..." node scripts/verify-previews.mjs [--all] [--reader]');
console.error('  --all : les quatre dossiers · --reader : ouvre aussi chaque mail (compte les « � » du corps)');
console.error('  (ton mot de passe ne quitte pas ta machine : il part uniquement, chiffré HTTPS, vers ta propre API.)');
    process.exit(2);
}

const folders = process.argv.includes('--all')
    ? ['inbox', 'sent', 'junk', 'trash']
    : ['inbox'];
// --reader : ouvre aussi chaque mail comme le fait le lecteur
// (?uid=) — le corps SUIVI de près, pas seulement l'aperçu de liste.
const readBodies = process.argv.includes('--reader');

const fffd = (s) => (String(s).match(/\uFFFD/g) || []).length;

let issues = 0;

for (const folder of folders) {
    const res = await fetch(`${BASE}/api/mail?folder=${folder}`, {
        headers: { 'x-mail-user': user, 'x-mail-pass': pass, 'x-real-ip': 'verify-previews' }
    });
    if (res.status !== 200) {
        console.error(`GET ${folder} → ${res.status} ${JSON.stringify((await res.json()) || {})}`);
        issues++;
        continue;
    }
    const { mails } = await res.json();
    console.log(`\n== ${folder} : ${mails.length} mails ==`);
    for (const m of mails) {
        const previewFffd = fffd(m.preview);
        // mail accentué = susceptible d'avoir déclenché le mojibake ;
        // le sujet EST aussi analysé : il est décodé par mailparser côté serveur
        const accented = /[éèêàâçôûùÉÈÊÀÂÇÔÛÙ]/.test(m.subject);
        const tag = accented ? ' [accentué]' : '';
        console.log(`  · ${m.subject.slice(0, 50)}${tag}\n    aperçu : ${JSON.stringify((m.preview || '').slice(0, 90))}${previewFffd ? ` → ${previewFffd} « � »` : ''}`);
        if (previewFffd > 0) {
            issues++;
            console.log(`    FAIL : ${previewFffd} caractère(s) « � » dans l'aperçu`);
        }

        if (readBodies) {
            const r = await fetch(`${BASE}/api/mail?uid=${m.uid}&folder=${folder}`, {
                headers: { 'x-mail-user': user, 'x-mail-pass': pass, 'x-real-ip': 'verify-previews' }
            });
            if (r.status !== 200) {
                console.log(`    lecteur → HTTP ${r.status}`);
                issues++;
            } else {
                const { mail } = await r.json();
                const body = String((mail && mail.text) || '');
                const fffdBody = fffd(body);
                const fffdSubject = fffd(String((mail && mail.subject) || ''));
                console.log(`    lecteur uid=${m.uid} · body FFFD=${fffdBody} · sujet FFFD=${fffdSubject}`);
                console.log(`      début du corps : ${JSON.stringify(body.slice(0, 160))}`);
                if (fffdBody > 0 || fffdSubject > 0) {
                    issues++;
                    console.log(`      FAIL : ${fffdBody + fffdSubject} « � » à la LECTURE — forme d'octets non couverte, à rapporter telle quelle`);
                }
            }
        }
    }
}

console.log(`\nRésultat : ${issues === 0 ? 'PASS — aucun « � » dans les aperçus servis' : `FAIL — ${issues} problème(s)`}`);
process.exit(issues > 0 ? 1 : 0);
