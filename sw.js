// Service worker UVSQ EDT
// - Shell préchargé (offline : l'app s'ouvre même sans réseau)
// - API /api/edt : jamais interceptée — la PWA gère déjà son propre repli
//   (cache localStorage des cours) et ses messages d'erreur
// - CDN (Tailwind, FontAwesome) : stale-while-revalidate pour garder le style
//   et les icônes disponibles hors-ligne après la première visite
const CACHE_NAME = 'uvsq-edt-v21';
const RUNTIME_CACHE = 'uvsq-edt-runtime-v1';
const RUNTIME_LIMIT = 100;

const PRECACHE = [
    '/',
    '/index.html',
    '/manifest.json',
    '/js/utils.js',
    '/js/ui.js',
    '/js/app.js',
    '/js/mail.js',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon-maskable-512.png',
    '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(PRECACHE);
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== CACHE_NAME && k !== RUNTIME_CACHE)
            .map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

// Limite de taille du cache runtime (CDN) : évite une croissance sans fin
async function trimRuntimeCache(cache) {
    const keys = await cache.keys();
    if (keys.length <= RUNTIME_LIMIT) return;
    await cache.delete(keys[0]);
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // Origine propre
    if (url.origin === self.location.origin) {
        if (url.pathname.startsWith('/api/')) return; // voir l'en-tête du fichier

        // Navigations : réseau d'abord, repli sur le shell préchargé
        if (req.mode === 'navigate') {
            event.respondWith((async () => {
                try {
                    return await fetch(req);
                } catch (e) {
                    const cache = await caches.open(CACHE_NAME);
                    return (await cache.match('/')) || (await cache.match('/index.html')) || Response.error();
                }
            })());
            return;
        }

        // Assets locaux : cache d'abord, sinon réseau puis mise en cache
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            const hit = await cache.match(req);
            if (hit) return hit;
            try {
                const res = await fetch(req);
                if (res && res.ok) await cache.put(req, res.clone());
                return res;
            } catch (e) {
                return Response.error();
            }
        })());
        return;
    }

    // Tierces (cdn.tailwindcss.com, cdnjs.cloudflare.com…) : stale-while-revalidate.
    // Premier chargement en ligne remplit le cache ; ensuite, hors-ligne, le style reste appliqué.
    event.respondWith((async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const hit = await cache.match(req);
        if (hit) {
            fetch(req).then(res => {
                if (res && (res.ok || res.type === 'opaque')) {
                    cache.put(req, res.clone()).then(() => trimRuntimeCache(cache));
                }
            }).catch(() => { /* hors-ligne : le hit suffit */ });
            return hit;
        }
        try {
            const res = await fetch(req);
            if (res && (res.ok || res.type === 'opaque')) {
                await cache.put(req, res.clone());
                trimRuntimeCache(cache);
            }
            return res;
        } catch (e) {
            return Response.error();
        }
    })());
});
