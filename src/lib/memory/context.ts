import type { Memory } from "./types";

/**
 * The always-on memory block (R.memory): every active hard fact and rule, always included, since an answer must never violate one. Soft
 * preferences are added newest-first up to a modest character budget (a rough stand-in for a token budget; a single-owner store starts
 * empty and grows slowly, so this is not expected to bind for a long time) — trimmed, never the hard tier. No vector search: the whole
 * point of a small, single-owner store is that a model can just be given everything active and reason over it directly.
 */
const SOFT_BUDGET_CHARS = 4000;

const line = (memory: Memory) => `- [${memory.type}${memory.strength === "hard" ? ", hard" : ""}, stated ${memory.createdAt.slice(0, 10)}] ${memory.statement}`;

export function buildMemoryContext(memories: Memory[]): string {
  const active = memories.filter((memory) => memory.status === "active");
  if (!active.length) return "";
  const hard = active.filter((memory) => memory.strength === "hard").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const soft = active.filter((memory) => memory.strength === "soft").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const hardLines = hard.map(line);
  const softLines: string[] = [];
  let used = hardLines.join("\n").length;
  for (const memory of soft) {
    const text = line(memory);
    if (used + text.length + 1 > SOFT_BUDGET_CHARS) break;
    softLines.push(text);
    used += text.length + 1;
  }
  return `About this person — apply these to your answer, do not just note them (never mention "memory" mechanically; just use it):
A hard one is a real constraint: before you name a specific product, food, supplement, ingredient or place, check it against every hard fact below and rule out anything that conflicts, exactly as you would for a stated allergy or a diet restriction — this applies to sourcing too, not just the food itself (a diet fact that excludes an animal excludes a supplement made from that animal, e.g. bovine or porcine collagen, gelatin, or broth). A soft one is guidance, not an absolute rule. When a fact changed what you recommended, say briefly which one ("since you don't eat beef or pork, going with a marine collagen").
${[...hardLines, ...softLines].join("\n")}`;
}
