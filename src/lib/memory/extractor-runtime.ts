import { callClaude } from "@/lib/runtime/model-runtime";
import { extractMemories } from "./extractor";
import { createMemory, listMemories, supersedeMemory } from "./store";

export function extractMemoriesForUser(userId: string, userMessage: string, existing: Parameters<typeof extractMemories>[1]) {
  return extractMemories(userMessage, existing, { complete: (params) => callClaude("memory_extractor", params, { userId }) });
}

/**
 * The async writer (R.memory): reads the person's own message, reconciles against what's already stored, and applies the result. Meant to
 * run after the response is already on its way to the person (see the `after()` call in the chat route), so it never adds latency and a
 * failure here never surfaces to them — nothing is remembered rather than remembered wrong.
 */
export async function writeMemoriesFromMessage(userId: string, userMessage: string) {
  try {
    const existing = await listMemories(userId, ["active", "pending"]);
    const candidates = await extractMemoriesForUser(userId, userMessage, existing);
    for (const candidate of candidates) {
      const status = candidate.stated ? "active" : "pending";
      const id = await createMemory(userId, { type: candidate.type, category: candidate.category, strength: candidate.strength, statement: candidate.statement, status, validUntil: candidate.validUntil, sourceExcerpt: userMessage.slice(0, 300) });
      if (candidate.action === "update" && candidate.supersedes) await supersedeMemory(userId, candidate.supersedes, id);
    }
    return candidates.length;
  } catch {
    return 0; // Best effort; the person's turn has already completed regardless.
  }
}
