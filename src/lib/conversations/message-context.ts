import { decryptText } from "@/lib/security/encryption";
export function messageChoices(ciphertext: unknown): { choices?: string[] } {
  if (typeof ciphertext !== "string" || !ciphertext) return {};
  try {
    const parsed: unknown = JSON.parse(decryptText(ciphertext));
    if (!parsed || typeof parsed !== "object" || !("choices" in parsed) || !Array.isArray(parsed.choices)) return {};
    const choices = parsed.choices.filter((choice): choice is string => typeof choice === "string" && choice.length > 0 && choice.length <= 200).slice(0, 8);
    return choices.length ? {choices} : {};
  } catch { return {}; }
}
