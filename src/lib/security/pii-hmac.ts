import { createHmac } from "node:crypto";

export function piiHmac(value: string) {
  const key = process.env.PII_HMAC_KEY;
  if (!key) throw new Error("PII_HMAC_KEY is not configured");
  return createHmac("sha256", key).update(value).digest("base64url");
}
