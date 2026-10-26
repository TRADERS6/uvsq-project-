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

console.log(`\nRésultat : ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
