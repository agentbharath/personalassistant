import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function encryptionKey() {
  const secret = process.env.APP_ENCRYPTION_KEY;
  if (!secret) throw new Error("APP_ENCRYPTION_KEY is not configured");
  if (process.env.NODE_ENV === "production" && Buffer.byteLength(secret) < 32) throw new Error("APP_ENCRYPTION_KEY must contain at least 32 random bytes of key material");
  return createHash("sha256").update(secret).digest();
}

export function encryptText(plaintext: string, context?: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  if (context) cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [context ? "v2" : "v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptText(payload: string, context?: string) {
  const [version, iv, tag, ciphertext] = payload.split(":");
  if (payload.split(":").length !== 4 || !["v1", "v2"].includes(version) || !iv || !tag || ciphertext === undefined || (version === "v2" && !context)) throw new Error("Invalid encrypted payload");
  if (Buffer.from(iv, "base64url").length !== 12 || Buffer.from(tag, "base64url").length !== 16) throw new Error("Invalid encrypted payload");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  if (version === "v2") decipher.setAAD(Buffer.from(context!));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
