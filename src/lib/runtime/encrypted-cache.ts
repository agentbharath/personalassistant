import { Redis } from "@upstash/redis";
import { decryptText, encryptText } from "@/lib/security/encryption";
import { piiHmac } from "@/lib/security/pii-hmac";

export type TextCache = { get(material: string): Promise<string | null>; set(material: string, value: string): Promise<void> };

let redis: Redis | undefined;
function getRedis() {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return undefined;
  redis = new Redis({ url, token });
  return redis;
}

/**
 * A per-user cache for private text. Keys are keyed hashes and values are encrypted, because what is cached (mail details, readings of messages)
 * is private. Without Redis it falls back to a per-instance memory cache, which is repeatable within an instance but not across them.
 */
export function createEncryptedCache({ prefix, ttlSeconds, memoryLimit = 500 }: { prefix: string; ttlSeconds: number; memoryLimit?: number }): TextCache {
  const memory = new Map<string, { value: string; expires: number }>();
  const keyOf = (material: string) => `${prefix}:${piiHmac(material)}`;
  return {
    async get(material) {
      const key = keyOf(material);
      const remote = await getRedis()?.get<string>(key);
      if (remote) return decryptText(remote);
      const local = memory.get(key);
      if (!local) return null;
      if (local.expires <= Date.now()) { memory.delete(key); return null; }
      return local.value;
    },
    async set(material, value) {
      const key = keyOf(material);
      const remote = getRedis();
      if (remote) await remote.set(key, encryptText(value), { ex: ttlSeconds });
      if (memory.size >= memoryLimit) memory.delete(memory.keys().next().value as string);
      memory.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
    },
  };
}
