// Rate-limit en mémoire (par instance warm) : bucket de jetons par clé (IP),
// utilisé par api/edt.js. Sans dépendance, purgé périodiquement.
// Limites honnêtes : chaque instance Vercel a sa campe — le compte est
// approximatif, le but est de bloquer les floods, pas de facturer au pas.
export const buckets = new Map();

const MAX_BUCKETS = 10000;
const MAX_AGE_MS = 30 * 60 * 1000;

export function rateLimit(key, { burst = 60, refillPerSec = 2, now = Date.now() } = {}) {
    if (buckets.size > MAX_BUCKETS) {
        for (const [k, b] of buckets) {
            if (now - b.last > MAX_AGE_MS) buckets.delete(k);
        }
        if (buckets.size > MAX_BUCKETS) buckets.clear(); // garde-fou mémoire dashboard
    }

    let bucket = buckets.get(key);
    if (!bucket) {
        bucket = { tokens: burst, last: now };
        buckets.set(key, bucket);
    }

    // Recharge proportionnelle au temps écoulé (plafonnée à burst)
    const elapsedSec = Math.max(0, (now - bucket.last) / 1000);
    bucket.tokens = Math.min(burst, bucket.tokens + elapsedSec * refillPerSec);
    bucket.last = now;

    if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return { allowed: true, remaining: Math.floor(bucket.tokens) };
    }

    const waitSec = Math.ceil((1 - bucket.tokens) / refillPerSec);
    return { allowed: false, retryAfterSec: Math.max(1, waitSec) };
}
