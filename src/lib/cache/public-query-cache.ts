import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import { getRequestContext } from "@/lib/runtime/request-context";

let redis: Redis | undefined;
const inFlight = new Map<string, Promise<string>>();

export function isPublicCacheEligible(query: string) {
  const normalized = normalizePublicQuery(query);
  if (!normalized || normalized.length > 300) return false;
  return !(
    /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(query)
    || /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/.test(query)
    || /\b\d{1,6}\s+[a-z0-9.' -]+\s(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct)\b/i.test(query)
    || /\b(?:account|routing|card|ssn|social security|confirmation)\b.{0,20}\d{4,}/i.test(query)
    || /\b(?:near me|my location|my home|my house|my work|my office)\b/i.test(query)
    || /\b(?:my email|my calendar|my spending|my transaction|my receipt|my bill)\b/i.test(query)
  );
}

export function normalizePublicQuery(query: string) {
  return query.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * `extra` folds anything besides the query text into the cache key — right now, the person's active hard facts and rules (R31), so a
 * personalized answer ("since you don't eat beef...") is never served to a different fact set, and a fact learned after the answer was
 * cached produces a fresh one instead of the stale unpersonalized one. Empty when nothing personal applies, so an ordinary public query is
 * cached exactly as before.
 */
export async function withPublicQueryCache(query: string, load: () => Promise<string>, extra = "") {
  if (!isPublicCacheEligible(query)) {
    recordCache(false);
    return load();
  }
  const key = `public-search:v7:${createHash("sha256").update(`${normalizePublicQuery(query)}||${extra}`).digest("hex")}`;
  try {
    const cached = await getRedis()?.get<unknown>(key);
    if (cached) {
      recordCache(true);
      // Redis parses a stored JSON string into an object on the way out, so put it back to the text that was stored.
      return typeof cached === "string" ? cached : JSON.stringify(cached);
    }
  } catch { /* Cache is optional. */ }
  recordCache(false);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = load().then(async (value) => {
    try { await getRedis()?.set(key, value, { ex: 900 }); } catch { /* Cache is optional. */ }
    return value;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

function recordCache(hit: boolean) {
  const context = getRequestContext();
  if (!context) return;
  if (hit) context.cacheHits = (context.cacheHits ?? 0) + 1;
  else context.cacheMisses = (context.cacheMisses ?? 0) + 1;
}

function getRedis() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return undefined;
  redis ??= Redis.fromEnv();
  return redis;
}
