// Debug des erreurs cachées du front : deux familles de pannes silencieuses.
// 1. un onclick/onsubmit HTML pointe vers une fonction JS inexistante → clic mort
// 2. un getElementById() vise un identifiant absent du HTML → TypeError au moment voulu
import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const jsFiles = ['js/utils.js', 'js/ui.js', 'js/mail.js', 'js/app.js'];
const js = jsFiles.map(f => ({ f, src: fs.readFileSync(f, 'utf8') }));
const allJs = js.map(x => x.src).join('\n');

let pass = 0, fail = 0;
const log = (ok, label, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' → ' + detail : ''}`);
    ok ? pass++ : fail++;
};

// ---------- 1. fonctions posées dans les attributs on* du HTML ----------
const onAttrs = [...html.matchAll(/on(?:click|submit|input|change)="([A-Za-z_]\w*)\(/g)].map(m => m[1]);
const declaredFns = new Set();
for (const { src } of js) {
    for (const m of src.matchAll(/function\s+([A-Za-z_]\w*)/g)) declaredFns.add(m[1]);
    for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/g)) declaredFns.add(m[1]);
}
for (const m of allJs.matchAll(/window\.([A-Za-z_]\w*)\s*=/g)) declaredFns.add(m[1]);

// Bibliothèques externes (TailwindCDN, FA…) et API du navigateur utilisables en on*
const externals = new Set(['alert', 'confirm', 'prompt', 'saveOnboarding', 'saveSettings']);
const missingFns = [...new Set(onAttrs)].filter(f => !declaredFns.has(f));
log(missingFns.length === 0, ' Handlers HTML → JS', missingFns.length ? `manquants : ${missingFns.join(', ')}` : `${new Set(onAttrs).size} fonctions toutes définies`);

// ---------- 2. getElementById → identifiants HTML réels ----------
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const usedIds = new Set([
    ...js.flatMap(({ src }) => [...src.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)].map(m => m[1])),
    ...js.flatMap(({ src }) => [...src.matchAll(/getElementById\(\s*"([^"]+)"\s*\)/g)].map(m => m[1]))
].filter(id => !id.includes('$'))); // ids construits dynamiquement (template literals) exclus
// ids créés par le code lui-même via  el.id = 'x'  (sinon faux positif)
const dynamicIds = new Set([...allJs.matchAll(/\.id\s*=\s*'([\w-]+)'/g)].map(m => m[1]));
const missingIds = [...usedIds].filter(id => !htmlIds.has(id) && !dynamicIds.has(id));
log(missingIds.length === 0, ' getElementById → HTML', missingIds.length ? `absents : ${missingIds.join(', ')}` : `${usedIds.size} identifiants tous présents`);

// ---------- 3. variables globales mutuellement utilisées (annexes) ----------
// timetableData / appConfig (app.js) sont utilisés dans ui.js et mail.js
const shared = ['timetableData', 'appConfig', 'activeViewMode', 'searchQuery'];
for (const name of shared) {
    const used = js.some(({ f, src }) => f !== 'js/app.js' && new RegExp(`(?<![\\w.])${name}(?![\\w])`).test(src));
    const declared = /(?:let|var|const)\s+timetableData|(?:const|let|var)\s+appConfig|let\s+activeViewMode|let\s+searchQuery/.test(allJs);
    log(!used || declared, ` partagé « ${name} »`, used && declared ? 'déclaré quelque part ✓' : used ? 'UTILISÉ SANS DÉCLARATION' : 'non partagé, ok');
}

// ---------- 4. imports backend ↔ exports ----------
const importsModule = (file, exported) => {
    const m = [...fs.readFileSync(file, 'utf8').matchAll(/import\s*{([^}]*)}\s*from\s*'([^']*)'/g)]
        .flatMap(m => m[1].split(',').map(s => s.trim()).filter(Boolean).map(n => ({ n, from: m[2] })));
    return m;
};
const exportsOf = (file) => new Set([...fs.readFileSync(file, 'utf8').matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z_]\w*)/g)].map(m => m[1]));
for (const file of ['api/edt.js', 'api/mail.js']) {
    let ok = true, detail = [];
    for (const { n, from } of importsModule(file)) {
        // '../lib/x.js' → './lib/x.js' ; './x.js' → './api/x.js'
        const srcPath = from.startsWith('..') ? `./${from.slice('../'.length)}` : `./${file.split('/')[0]}/${from.replace('./', '')}`;
        try {
            const exp = exportsOf(srcPath);
            if (!exp.has(n)) { ok = false; detail.push(`${n} absent de ${srcPath}`); }
        } catch (e) { ok = false; detail.push(`${from} illisible`); }
    }
    log(ok, ` imports de ${file}`, detail.length ? detail.join('; ') : 'tous les symboles exportés ✓');
}

// ---------- 5. classification du lecteur (un cas par type présenté) ----------
// classifyMail vit dans js/mail.js (script classique, pas d'export) : on
// extrait SA source réelle et on l'évalue isolément — la fonction n'ayant
// aucune dépendance (ni DOM ni réseau), l'extraction est un test fidèle.
{
    const mailSrc = js.find(x => x.f === 'js/mail.js').src;
    const start = mailSrc.indexOf('function classifyMail');
    const end = mailSrc.indexOf('function relativeMailDate');
    try {
        const classify = new Function(`${mailSrc.slice(start, end)}; return classifyMail;`)();
        const checks = [
            ['invitation · objet contenant « invitation »',
                { subject: 'Invitation : TD F306', text: 'date et salle dans le texte' }, 'a@x.fr', 'invitation'],
            ['invitation · pièce VCALENDAR dans le corps',
                { subject: 'Réunion GMP', text: 'BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR' }, 'a@x.fr', 'invitation'],
            ['newsletter · expéditeur no-reply',
                { subject: 'Le journal du campus', text: 'Bonne lecture !' }, 'noreply@uvsq.fr', 'newsletter'],
            ['newsletter · mot de désabonnement dans le corps',
                { subject: 'Bons plans', text: 'Pour vous désabonner de cette liste, suivez ce lien.' }, 'promo@partenaire.fr', 'newsletter'],
            ['notification · service UVSQ (@uvsq.fr sans @etu)',
                { subject: 'Congé de la bibliothèque', text: 'Fermeture exceptionnelle.' }, 'prenom.nom@uvsq.fr', 'notification'],
            ['personnel · adresse étudiante (aucune puce attendue)',
                { subject: 'Salut, tu viens ce soir ?', text: 'Réponds vite !' }, 'bob@etu.uvsq.fr', 'personnel'],
            ['personnel · sans expéditeur ni objet', { subject: '', text: '.' }, '', 'personnel'],
            ['priorité invitation > newsletter (VCALENDAR gagne)',
                { subject: 'Invitation carrière', text: 'BEGIN:VCALENDAR...vous recevez ce message car...' }, 'no-reply@uvsq.fr', 'invitation']
        ];
        for (const [label, mail, address, wanted] of checks) {
            const got = classify(mail, { name: '', address });
            const ok = got === wanted;
            console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} → ${got}${ok ? '' : ` (attendu : ${wanted})`}`);
            ok ? pass++ : fail++;
        }
    } catch (e) {
        console.log(`FAIL  classification du lecteur : extraction de classifyMail impossible (${e.message})`);
        fail++;
    }
}

console.log(`\nRésultat : ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
