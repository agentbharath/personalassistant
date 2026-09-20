import { Redis } from "@upstash/redis";
import { callClaude } from "@/lib/runtime/model-runtime";
import { decryptText, encryptText } from "@/lib/security/encryption";
import { piiHmac } from "@/lib/security/pii-hmac";
import { interpretEmail, type InterpretationCache, type InterpreterInput } from "./email-interpreter";

const TTL_SECONDS = 30 * 24 * 60 * 60;
const MEMORY_LIMIT = 500;
const memory = new Map<string, string>();
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
 * R16.3: per-user cache of interpretations. Keys are keyed hashes and values are encrypted, because messages are private.
 * Without Redis it falls back to a per-instance memory cache, which is repeatable within an instance but not across them.
 */
export function createInterpretationCache(): InterpretationCache {
  return {
    async get(material) {
      const key = `email-interp:${piiHmac(material)}`;
      const remote = await getRedis()?.get<string>(key);
      if (remote) return decryptText(remote);
      return memory.get(key) ?? null;
    },
    async set(material, value) {
      const key = `email-interp:${piiHmac(material)}`;
      const remote = getRedis();
      if (remote) await remote.set(key, encryptText(value), { ex: TTL_SECONDS });
      if (memory.size >= MEMORY_LIMIT) memory.delete(memory.keys().next().value as string);
      memory.set(key, value);
    },
  };
}

const cache = createInterpretationCache();

export function interpretEmailForUser(input: InterpreterInput) {
  return interpretEmail(input, { complete: (params) => callClaude("email_interpretation", params), cache });
}
