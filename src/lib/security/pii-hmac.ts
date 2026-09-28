import { createHmac } from "node:crypto";

export function piiHmac(value: string) {
  const key = process.env.PII_HMAC_KEY;
  if (process.env.NODE_ENV === "production" && key && Buffer.byteLength(key) < 32) throw new Error("PII_HMAC_KEY must be at least 32 bytes");
  if (!key) throw new Error("PII_HMAC_KEY is not configured");
  return createHmac("sha256", key).update(value).digest("base64url");
}
