import type { WeeklySpending } from "@/lib/today/brief";

/**
 * Some agent answers carry a rich card alongside their plain-text reply, instead of a migration adding a card
 * column: the payload rides as a trailing fenced block in the same stored/encrypted message content. Older
 * messages and any reader that doesn't know this convention see it as an ordinary (if odd-looking) code fence;
 * the chat UI strips it and renders the card instead. The prose before the fence is what "Copy answer" copies
 * and what a client that doesn't render cards falls back to, so it must stand alone.
 */
const FENCE = /\n*```daylark-card\n([\s\S]*?)\n```\s*$/;

export type SpendingCardPayload = { kind: "spending"; periodLabel: string; filterLabel: string | null; insight: string; summary: WeeklySpending };
export type CardPayload = SpendingCardPayload;

export function embedCard(text: string, payload: CardPayload): string {
  return `${text}\n\n\`\`\`daylark-card\n${JSON.stringify(payload)}\n\`\`\``;
}

/** Never throws: a malformed or unrecognized payload just means no card, the prose (unstripped) stands alone. */
export function extractCard(content: string): { text: string; card: CardPayload | null } {
  const match = content.match(FENCE);
  if (!match) return { text: content, card: null };
  try {
    const parsed = JSON.parse(match[1]) as { kind?: string };
    if (parsed.kind !== "spending") return { text: content, card: null };
    return { text: content.slice(0, match.index).trimEnd(), card: parsed as CardPayload };
  } catch {
    return { text: content, card: null };
  }
}
