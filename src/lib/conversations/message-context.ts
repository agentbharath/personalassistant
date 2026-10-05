import { decryptText } from "@/lib/security/encryption";
export type MessageMetadata = { choices?: string[]; notice?: boolean; retryable?: boolean };

/** Optional encrypted UI metadata; existing messages and schemas remain readable. */
export function messageChoices(ciphertext: unknown): MessageMetadata {
  if (typeof ciphertext !== "string" || !ciphertext) return {};
  try {
    const parsed: unknown = JSON.parse(decryptText(ciphertext));
    if (!parsed || typeof parsed !== "object") return {};
    const value = parsed as Record<string, unknown>;
    const choices = Array.isArray(value.choices) ? value.choices.filter((choice): choice is string => typeof choice === "string" && choice.length > 0 && choice.length <= 200).slice(0, 8) : [];
    return { ...(choices.length ? { choices } : {}), ...(value.notice === true ? { notice: true } : {}), ...(typeof value.retryable === "boolean" ? { retryable: value.retryable } : {}) };
  } catch { return {}; }
}
