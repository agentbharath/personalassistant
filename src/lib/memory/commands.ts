import type { Memory } from "./types";

/**
 * "Forget X" is a data lookup against what's already stored, not a classification of what the person meant — the router already decided
 * this is a forget-memory request and read out `term`; this just finds which stored row(s) it names, so R20.5 (no rules to classify intent)
 * does not apply here (compare `sameMerchant` for bills, the same kind of lookup).
 */
export function findMatchingMemories(memories: Memory[], term: string): Memory[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return [];
  return memories.filter((memory) => memory.statement.toLowerCase().includes(needle) || memory.category.toLowerCase() === needle);
}

const TYPE_TITLE = { fact: "Facts", preference: "Preferences", rule: "Rules" } as const;

export function renderMemories(active: Memory[], pending: Memory[]): string {
  if (!active.length && !pending.length) {
    return "I haven't remembered anything yet. Tell me something lasting (\"I don't eat meat except fish and chicken\", \"always ask before importing transactions\") and I will.";
  }
  const sections = (["fact", "preference", "rule"] as const).flatMap((type) => {
    const items = active.filter((memory) => memory.type === type);
    return items.length ? [`**${TYPE_TITLE[type]}**\n${items.map((memory) => `- ${memory.statement}`).join("\n")}`] : [];
  });
  const waiting = pending.length ? `\n\n**Waiting for you to confirm**\n${pending.map((memory) => `- ${memory.statement}`).join("\n")}\n\nSay it again if it's right, or "forget ${pending[0].statement.split(" ").slice(0, 3).join(" ")}..." if it's not.` : "";
  return `### What I remember\n\n${sections.join("\n\n")}${waiting}\n\nSay "forget <something>" to remove anything above.`;
}
