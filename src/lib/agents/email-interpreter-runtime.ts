import { callClaude } from "@/lib/runtime/model-runtime";
import { createEncryptedCache } from "@/lib/runtime/encrypted-cache";
import { interpretEmail, type InterpretationCache, type InterpreterInput } from "./email-interpreter";

/** R16.3: per-user cache of interpretations, kept for 30 days. Keys are keyed hashes and values are encrypted, because messages are private. */
export function createInterpretationCache(): InterpretationCache {
  return createEncryptedCache({ prefix: "email-interp", ttlSeconds: 30 * 24 * 60 * 60 });
}

const cache = createInterpretationCache();

export function interpretEmailForUser(input: InterpreterInput) {
  return interpretEmail(input, { complete: (params) => callClaude("email_interpretation", params), cache });
}
