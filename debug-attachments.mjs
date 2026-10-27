// Debug pièces jointes : traverse le VRAI parser imapflow (parseBodystructure)
// avec des BODYSTRUCTURE réalistes, puis le VRAI collecteur de lib/mail.js.
// Séquence IMAP d'une part NON multipart : type1 type2 params ID DESC ENC SIZE
// puis extensions : MD5, DISPOSITION, LANGUE, LOCATION. Pour text/* : SIZE
// est suivi de LINECOUNT avant les extensions.
import { parseBodystructure } from './node_modules/imapflow/dist/esm/tools.js';
import { collectAttachmentParts, extractMailAddresses, parseWithCharsetRepair, decodePreviewBytes, htmlToText, findTextPart } from './lib/mail.js';
import { simpleParser } from 'mailparser';

const A = (v) => ({ type: 'ATOM', value: v });
const S = (v) => ({ type: 'STRING', value: v });

let pass = 0, fail = 0;
const run = (label, bodystructure, expect) => {
    let structure;
    try {
        structure = parseBodystructure(bodystructure);
    } catch (e) {
        console.log(`FAIL ${label} : parseBodystructure a levé : ${e.message}`);
        fail++;
        return;
    }
    const parts = collectAttachmentParts(structure);
    const wanted = parts.map(p => ({
        part: p.part, name: p.name, type: p.type, size: p.size, disposition: p.disposition || undefined
    }));
    const got = JSON.stringify(wanted);
    const exp = JSON.stringify(expect);
    if (got === exp) {
        console.log(`PASS ${label} → ${parts.map(p => `${p.part}:${p.name}`).join(', ') || '(aucune)'}`);
        pass++;
    } else {
        console.log(`FAIL ${label}\n  attendu: ${exp}\n  obtenu : ${got}`);
        fail++;
    }
};

// ---------- Cas A : multipart/mixed, attachment avec disposition ----------
// (style Dovecot/Partage classique : doit être téléchargeable)
// les deux null après params = ID puis DESCRIPTION ; SIZE suit ENC
run('A · multipart + disposition attachment + nom RFC2047',
    [
        [
            A('TEXT'), A('PLAIN'), [S('CHARSET'), S('UTF-8')], null, null, S('7BIT'), S('12'), S('1')
        ],
        [
            A('APPLICATION'), A('PDF'), [S('NAME'), S('rapport.pdf')], null, null, S('BASE64'), S('20480'),
            null, [A('ATTACHMENT'), [S('FILENAME'), S('=?UTF-8?B?cmFwcG9ydC5wZGY=?=')]]
        ],
        A('MIXED')
    ],
    [{ part: '2', name: 'rapport.pdf', type: 'application/pdf', size: 20480 }]
);

// ---------- Cas B : AUCUNE disposition mais NAME sur part NON text ----------
// (serveurs qui omettent CONTENT-DISPOSITION ; détecté par l'heuristique nom+type)
run('B · pas de disposition, name= sur application/pdf',
    [
        [
            A('TEXT'), A ('PLAIN'), [S('CHARSET'), S('UTF-8')], null, null, S('7BIT'), S('12'), S('1')
        ],
        [
            A('APPLICATION'), A('PDF'), [S('NAME'), S('=?UTF-8?B?ZG9jdW1lbnQucGRm?=')], null, null, S('BASE64'), S('4096')
        ],
        A('MIXED')
    ],
    [{ part: '2', name: 'document.pdf', type: 'application/pdf', size: 4096 }]
);

// ---------- Cas C : image inline avec filename (logos etc.) ----------
run('C · inline + filename (logo)',
    [
        [
            A('TEXT'), A('HTML'), [S('CHARSET'), S('UTF-8')], null, null, S('7BIT'), S('45'), S('1')
        ],
        [
            A('IMAGE'), A('PNG'), null, null, null, S('BASE64'), S('777'),
            null, [A('INLINE'), [S('FILENAME'), S('logo.png')]]
        ],
        A('RELATED')
    ],
    [{ part: '2', name: 'logo.png', type: 'image/png', size: 777 }]
);

// ---------- Cas D : pièce jointe à la racine (message non multipart) ----------
run('D · PDF seul en racine (message non multipart)',
    [
        A('APPLICATION'), A('PDF'), [S('NAME'), S('donnees.pdf')], null, null, S('BASE64'), S('513'),
        null, [A('ATTACHMENT'), [S('FILENAME'), S('donnees.pdf')]]
    ],
    [{ part: '1', name: 'donnees.pdf', type: 'application/pdf', size: 513 }]
);

// ---------- Cas E : mail simple SANS pièce jointe — rien ne doit sortir ----------
run('E · texte simple sans PJ',
    [
        A('TEXT'), A('PLAIN'), [S('CHARSET'), S('UTF-8')], null, null, S('7BIT'), S('12'), S('1')
    ],
    []
);

// ---------- Cas F : multipart/alternative imbriqué + attachment à côté ----------
run('F · imbriqué (alternative + pdf)',
    [
        [
            [
                A('TEXT'), A('PLAIN'), [S('CHARSET'), S('UTF-8')], null, null, S('7BIT'), S('12'), S('1')
            ],
            [
                A('TEXT'), A('HTML'), [S('CHARSET'), S('UTF-8')], null, null, S('7BIT'), S('45'), S('1')
            ],
            A('ALTERNATIVE')
        ],
        [
            A('APPLICATION'), A('PDF'), [S('NAME'), S('td3.pdf')], null, null, S('BASE64'), S('2048'),
            null, [[A('ATTACHMENT'), [S('FILENAME'), S('td3.pdf')]]]
        ],
        A('MIXED')
    ],
    [{ part: '2', name: 'td3.pdf', type: 'application/pdf', size: 2048 }]
);

// ---------- Cas d'adresses (retour simpleParser) : messages SANS From ----------
// Formes réelles de simpleParser : AddressObject seul { value, html, text },
// liste de groupes, value vide, ou en-tête absent (spam, autogénérés).
// Bug visé ici : parsed.from.data n'existe pas → from était TOUJOURS null.
const runAddresses = (label, parsed, expect) => {
    const got = JSON.stringify(extractMailAddresses(parsed));
    const exp = JSON.stringify(expect);
    if (got === exp) {
        console.log(`PASS ${label} → ${expect.from ? `from=${expect.from.address}` : 'from=null'}${expect.to.length ? `, ${expect.to.length} to` : ''}`);
        pass++;
    } else {
        console.log(`FAIL ${label}\n  attendu: ${exp}\n  obtenu : ${got}`);
        fail++;
    }
};
const AObj = (...addr) => ({ value: addr, html: '', text: '' });

// G · pas d'en-tête From (spam, notification interne) → from null, to gardé
runAddresses('G · parsed sans From → from null, to conservé',
    { to: AObj({ name: 'Bob', address: 'bob@etu.uvsq.fr' }) },
    { from: null, to: [{ name: 'Bob', address: 'bob@etu.uvsq.fr' }], cc: [] });

// H · From présent classique (le cas réparé par la correction .data)
runAddresses('H · From AddressObject classique',
    { from: AObj({ name: 'Prof Martin', address: 'martin@uvsq.fr' }), to: AObj({ name: '', address: 'etu@etu.uvsq.fr' }), cc: null },
    { from: { name: 'Prof Martin', address: 'martin@uvsq.fr' }, to: [{ name: '', address: 'etu@etu.uvsq.fr' }], cc: [] });

// I · to/cc en LISTE de groupes (un AddressObject par groupe) : aplatissement nécessaire
runAddresses('I · to/cc listes de groupes',
    { from: AObj({ name: '', address: 'sec@etu.uvsq.fr' }), to: [AObj({ name: 'A', address: 'a@x.fr' }), AObj({ name: 'B', address: 'b@x.fr' })], cc: [AObj({ name: 'C', address: 'c@x.fr' })] },
    { from: { name: '', address: 'sec@etu.uvsq.fr' }, to: [{ name: 'A', address: 'a@x.fr' }, { name: 'B', address: 'b@x.fr' }], cc: [{ name: 'C', address: 'c@x.fr' }] });

// J · AddressObject abîmé : value vide ou champ absent
runAddresses('J · from/to vides ou null',
    { from: AObj(), to: null, cc: AObj() },
    { from: null, to: [], cc: [] });

// K & L · From encodé RFC 2047, au travers du VRAI simpleParser (pas simulé) :
// un expéditeur « Mélanie Toussaint » arrive en =?UTF-8?B?…?= dans le header ;
// mailparser le décode, extractMailAddresses doit le laisser passer en clair.
const runRaw = async (label, raw, expect) => {
    try {
        const parsed = await simpleParser(raw);
        const got = JSON.stringify(extractMailAddresses(parsed).from);
        const exp = JSON.stringify(expect);
        if (got === exp) {
            console.log(`PASS ${label} → from=${expect.address} (${expect.name})`);
            pass++;
        } else {
            console.log(`FAIL ${label}\n  attendu: ${exp}\n  obtenu : ${got}`);
            fail++;
        }
    } catch (e) {
        console.log(`FAIL ${label} : simpleParser a levé : ${e.message}`);
        fail++;
    }
};

const melanieH64 = Buffer.from('Mélanie Toussaint').toString('base64');
await runRaw('K · From RFC 2047 encodage B « Mélanie Toussaint »',
    Buffer.from(`From: =?UTF-8?B?${melanieH64}?= <m.toussaint@uvsq.fr>\r\nSubject: x\r\n\r\nBonjour\r\n`),
    { name: 'Mélanie Toussaint', address: 'm.toussaint@uvsq.fr' });

await runRaw('L · From RFC 2047 encodage Q « Jean-Luc Été »',
    Buffer.from(`From: =?UTF-8?Q?Jean-Luc_=C3=89t=C3=A9?= <jl.ete@uvsq.fr>\r\nSubject: x\r\n\r\nCordialement\r\n`),
    { name: 'Jean-Luc Été', address: 'jl.ete@uvsq.fr' });

// M & N · mojibake : corps Windows-1252 (é = 0xE9 sur un octet) déclaré utf-8
// ou us-ascii — classique des notificateurs automatiques : simpleParser produit
// des « � » ; parseWithCharsetRepair doit rendre les accents en clair.
const runMojibake = async (label, raw) => {
    try {
        const broken = await simpleParser(raw);
        const brokenText = broken.text || '';
        const hasReplace = /[\uFFFD]/.test(brokenText);
        const repaired = await parseWithCharsetRepair(raw);
        const repairedText = (repaired && repaired.text) || '';
        const ok = hasReplace && !/[\uFFFD]/.test(repairedText) && /modifi\S+ de 08:30/.test(repairedText);
        if (ok) {
            console.log(`PASS ${label} → « ${repairedText.trim().slice(0, 60)}… »`);
            pass++;
        } else {
            console.log(`FAIL ${label}\n  mojibake initial présent : ${hasReplace}\n  réparé : ${JSON.stringify(repairedText.slice(0, 80))}`);
            fail++;
        }
    } catch (e) {
        console.log(`FAIL ${label} : ${e.message}`);
        fail++;
    }
};

// Corps en octets Latin-1 (é sur un octet), étiquette mensongère utf-8
const bodyCp1252 = Buffer.from("Les heures de l\'\u00e9v\u00e9nement ont \u00e9t\u00e9 modifi\u00e9es de 08:30-10:30 \u00e0 10:30-12:30", 'latin1');
await runMojibake('M · corps Windows-1252 déclaré utf-8 → réparation',
    Buffer.concat([Buffer.from('From: notifs@uvsq.fr\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n', 'latin1'), bodyCp1252]));

await runMojibake('N · corps Windows-1252 déclaré us-ascii → réparation',
    Buffer.concat([Buffer.from('From: notifs@uvsq.fr\r\nContent-Type: text/plain; charset=us-ascii\r\n\r\n', 'latin1'), bodyCp1252]));

// ---------- O, P, Q · aperçu des listes : decodePreviewBytes ----------
// buildPreview ne passe pas par simpleParser : les octets du part texte y sont
// décodés à la main. Mêmes symptômes que M/N mais sur un autre chemin de code.
const runPreviewBytes = (label, bytes, expected) => {
    const got = decodePreviewBytes(bytes);
    const ok = got === expected && !got.includes('\uFFFD');
    if (ok) { console.log(`PASS ${label} → ${JSON.stringify(got.slice(0, 60))}`); pass++; }
    else { console.log(`FAIL ${label}\n  attendu: ${JSON.stringify(expected)}\n  obtenu : ${JSON.stringify(got)}`); fail++; }
};

// O · même corps Windows-1252 que M (é sur un octet) : la détection UTF-8
// stricte échoue (0xE9 invalide), le repli Windows-1252 rend l'accent.
runPreviewBytes('O · aperçu, octets 1252 → repli windows-1252', bodyCp1252,
    "Les heures de l'événement ont été modifiées de 08:30-10:30 à 10:30-12:30");

// P · vrai UTF-8 intact : décodage strict direct, sans repli (aucune régression
// pour les emails qui déclarent honnêtement leur charset).
runPreviewBytes('P · aperçu, UTF-8 honnête → décodage strict',
    Buffer.from("Les heures de l'événement ont été modifiées de 08:30-10:30 à 10:30-12:30", 'utf8'),
    "Les heures de l'événement ont été modifiées de 08:30-10:30 à 10:30-12:30");

// Q · coupe au maxBytes en PLEIN milieu du « é » multioctet (0xC3 seul en
// queue) : l'amputation d'un octet de queue amortit la coupe, zéro U+FFFD.
// Puis périmé volontairement : au-delà de 3 octets on renvoie le repli 1252
// (accents convertis en mojibake « Ã© » mais jamais de caractère perdu net).
const utf8Cropped = Buffer.from("Les heures de l'événement ont été", 'utf8').slice(0, -1);
runPreviewBytes('Q · aperçu, UTF-8 coupé mid-caractère → amorti', utf8Cropped,
    "Les heures de l'événement ont ét");

// ---------- R, S · aperçu d'un mail HTML-ONLY (chemin htmlToText) ----------
// Un mail sans text/plain : buildPreview descend sur text/html et, une fois
// les octets décodés, fait htmlToText(text) — on teste cet enchaînement exact.
const runPreviewHtml = (label, bytes, expected) => {
    const got = htmlToText(decodePreviewBytes(bytes)); // exactement buildPreview, apart le client IMAP
    const ok = got === expected && !got.includes('\uFFFD') && !/[<>]/.test(got);
    if (ok) { console.log(`PASS ${label} → ${JSON.stringify(got.slice(0, 60))}`); pass++; }
    else { console.log(`FAIL ${label}\n  attendu: ${JSON.stringify(expected)}\n  obtenu : ${JSON.stringify(got)}`); fail++; }
};

// R · HTML-only mojibake (octets 1252 sous étiquette utf-8, comme M/N/O) : le
// repli windows-1252 de decodePreviewBytes rend les accents AVANT htmlToText,
// qui doit décaper balises et style sans toucher au texte désormais propre.
const htmlMojibake = Buffer.from(
    '<html><head><style>body{color:red}</style></head><body>' +
    "<p>Les heures de l&#39;&#233;v&#233;nement ont &#233;t&#233; modifi&#233;es de 08:30-10:30 &#224; 10:30-12:30</p>" +
    '</body></html>', 'latin1');
runPreviewHtml('R · aperçu HTML-only mojibake → décodé puis débalisé', htmlMojibake,
    "Les heures de l'événement ont été modifiées de 08:30-10:30 à 10:30-12:30");

// ---------- T, U · aperçu multipart/alternative : sélection de la partie ----------
// Certains expéditeurs envoient une alternative dont la partie text/plain est
// une coquille VIDE (seul le HTML porte le corps) : findTextPart doit passer
// la partie vide et choisir le HTML (buildPreview évapore un aperçu vide).
const runTextPart = (label, bodystructure, expectPart, expectType) => {
    let structure, node;
    try {
        structure = parseBodystructure(bodystructure);
    } catch (e) {
        console.log(`FAIL ${label} : parseBodystructure a levé : ${e.message}`);
        fail++;
        return;
    }
    node = findTextPart(structure);
    const gotPart = node && node.part, gotType = node && node.type;
    if (gotPart === expectPart && gotType === expectType) {
        console.log(`PASS ${label} → part ${gotPart} (${gotType})`);
        pass++;
    } else {
        console.log(`FAIL ${label}\n  attendu: part ${expectPart} (${expectType})\n  obtenu : part ${gotPart} (${gotType})`);
        fail++;
    }
};

// T · plain présente mais vide (size 0) : le HTML gagne
defineAlternative('T · alternative à plain vide → part HTML', '0', '120', '2', 'text/html');

// U · plain avec un vrai contenu (size 120) : reste la partie choisie, aucune régression
defineAlternative('U · alternative à plain fournie → part plain', '120', '0', '1', 'text/plain');

function defineAlternative(label, plainSize, htmlSize, expectedPart, expectedType) {
    runTextPart(label,
        [
            [ A('TEXT'), A('PLAIN'), [S('CHARSET'), S('UTF-8')], null, null, S('7BIT'), S(plainSize), S('0') ],
            [ A('TEXT'), A('HTML'), [S('CHARSET'), S('UTF-8')], null, null, S('7BIT'), S(htmlSize), S('1') ],
            A('ALTERNATIVE')
        ],
        expectedPart, expectedType);
}

// S · HTML honnête UTF-8 avec entités nommées : htmlToText doit décoder les
// entités (&eacute; &agrave; &quot;) EN PLUS de décaper balises/style/script —
// le texte de l'aperçu ne peut jamais contenir ni balise ni entité brute.
const htmlEntities = Buffer.from(
    '<html><body><script>alert(1)</script>' +
    '<p>Heures d&#39;examen confirm&eacute;es &agrave; 10h30 &quot;dans la salle B&quot;</p>' +
    '</body></html>', 'utf8');
runPreviewHtml('S · aperçu HTML entités nommées → texte final lisible', htmlEntities,
    "Heures d'examen confirmées à 10h30 \"dans la salle B\"");

console.log(`\nRésultat : ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
