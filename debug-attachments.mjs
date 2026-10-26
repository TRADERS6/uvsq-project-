// Debug pièces jointes : traverse le VRAI parser imapflow (parseBodystructure)
// avec des BODYSTRUCTURE réalistes, puis le VRAI collecteur de lib/mail.js.
// Séquence IMAP d'une part NON multipart : type1 type2 params ID DESC ENC SIZE
// puis extensions : MD5, DISPOSITION, LANGUE, LOCATION. Pour text/* : SIZE
// est suivi de LINECOUNT avant les extensions.
import { parseBodystructure } from './node_modules/imapflow/dist/esm/tools.js';
import { collectAttachmentParts } from './lib/mail.js';

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

console.log(`\nRésultat : ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
