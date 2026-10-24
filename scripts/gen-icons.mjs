// Génération des icônes PWA (pur Node, aucune dépendance) :
// dégradé brand -> indigo, calendrier blanc avec anneaux, barre de séparation
// et deux "cours" stylisés. Les PNG sont encodés à la main (RGB, filter 0).
import { writeFile, mkdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

// ---------- Encodage PNG (RGB 8 bits, color type 2) ----------
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}

function pngEncode(size, rgb) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 2;   // color type RGB
    const raw = Buffer.alloc(size * (size * 3 + 1));
    for (let y = 0; y < size; y++) {
        raw[y * (size * 3 + 1)] = 0; // filter none
        rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

// ---------- Rastérisation ----------
function hexToRgb(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// Rectangle arrondi : test de recouvrement via clamp des centres d'angle
function inRoundRect(px, py, x0, y0, x1, y1, r) {
    if (px < x0 || px > x1 || py < y0 || py > y1) return false;
    if (r <= 0) return true;
    const cx = Math.min(Math.max(px, x0 + r), x1 - r);
    const cy = Math.min(Math.max(py, y0 + r), y1 - r);
    const dx = px - cx, dy = py - cy;
    return dx * dx + dy * dy <= r * r;
}

// shapes : fractions du côté (x, y, w, h, r = rayon en fraction de la largeur)
function render(size, shapes, bgFrom, bgTo) {
    const from = hexToRgb(bgFrom), to = hexToRgb(bgTo);
    const SS = 3; // anti-aliasing par 3x3 sous-échantillons
    const buf = Buffer.alloc(size * size * 3);

    const abs = shapes.map(s => ({
        x0: s.x * size, y0: s.y * size,
        x1: (s.x + s.w) * size, y1: (s.y + s.h) * size,
        r: s.r * s.w * size,
        color: hexToRgb(s.color)
    }));

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let r = 0, g = 0, b = 0;
            for (let sy = 0; sy < SS; sy++) {
                for (let sx = 0; sx < SS; sx++) {
                    const px = (x + (sx + 0.5) / SS) / size;
                    const py = (y + (sy + 0.5) / SS) / size;
                    let c = mix(from, to, (px + py) / 2);
                    for (const s of abs) {
                        if (inRoundRect(px * size, py * size, s.x0, s.y0, s.x1, s.y1, s.r)) c = s.color;
                    }
                    r += c[0]; g += c[1]; b += c[2];
                }
            }
            const n = SS * SS;
            const i = (y * size + x) * 3;
            buf[i] = Math.round(r / n);
            buf[i + 1] = Math.round(g / n);
            buf[i + 2] = Math.round(b / n);
        }
    }
    return buf;
}

// ---------- Design de l'icône (calendrier UVSQ EDT) ----------
const ICON_SHAPES = [
    // Corps du calendrier (blanc, coins arrondis)
    { x: 0.24, y: 0.27, w: 0.52, h: 0.47, r: 0.09, color: '#ffffff' },
    // Anneaux de reliure (au-dessus du corps, sur le dégradé)
    { x: 0.31, y: 0.215, w: 0.055, h: 0.10, r: 0.5, color: '#ffffff' },
    { x: 0.635, y: 0.215, w: 0.055, h: 0.10, r: 0.5, color: '#ffffff' },
    // Barre de séparation date / cours
    { x: 0.24, y: 0.355, w: 0.52, h: 0.024, r: 0.5, color: '#2563eb' },
    // Deux "cours" stylisés
    { x: 0.29, y: 0.41, w: 0.16, h: 0.07, r: 0.5, color: '#2563eb' },
    { x: 0.53, y: 0.41, w: 0.11, h: 0.07, r: 0.5, color: '#2563eb' },
    { x: 0.29, y: 0.525, w: 0.11, h: 0.07, r: 0.5, color: '#3b82f6' },
    { x: 0.45, y: 0.525, w: 0.19, h: 0.07, r: 0.5, color: '#3b82f6' }
];

async function main() {
    await mkdir('icons', { recursive: true });

    const jobs = [
        ['icons/icon-192.png', 192],
        ['icons/icon-512.png', 512],
        ['icons/icon-maskable-512.png', 512],
        ['icons/apple-touch-icon.png', 180]
    ];

    for (const [file, size] of jobs) {
        const rgb = render(size, ICON_SHAPES, '#3b82f6', '#4f46e5');
        await writeFile(file, pngEncode(size, rgb));
        console.log(`${file} (${size}x${size}) écrit`);
    }
}

main().catch(err => { console.error(err); process.exit(1); });
