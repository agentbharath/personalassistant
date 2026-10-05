import { extractCards } from "@/lib/chat/card-payload";
/** The follow-up buttons a card offered, as the exact messages tapping them sends. Score cards' link chips open a page instead, so only
 * the chips that send a message count. */
export function offeredChips(content: string): string[] {
  return extractCards(content).segments.flatMap((segment) => {
    const chips = segment.card && "chips" in segment.card ? (segment.card.chips ?? []) as Array<string | { text?: string }> : [];
    return chips.flatMap((chip) => { const text = typeof chip === "string" ? chip : chip.text; return text?.trim() ? [text.trim()] : []; });
  });
}

/** Cards carry machine-readable data after a complete prose answer. Keep their JSON out of routing context. */
export function assistantConversationText(content:string) {
  const {text,segments}=extractCards(content);
  if (!segments.some(segment=>segment.card)) return text;
  // The card's own JSON is kept out of routing, but what KIND of answer it was, and which buttons it offered, isn't noise: a follow-up like
  // "are they good?" only makes sense to route once the router can see the last answer was a list of suggested options, and a message that
  // is exactly one of the offered buttons is a tap -- a complete request, never a question back (found live: "Half-zip vs quarter-zip styles"
  // tapped from a card several turns up came back as "are you asking about the difference, or should I search?").
  const kind = segments.some(segment=>segment.card?.kind==="suggestion") ? "\n\n[Daylark showed this as a suggestions card: a top pick plus alternatives.]" : "";
  const chips = offeredChips(content).map((chip) => chip.slice(0, 160));
  return `${text}${kind}${chips.length ? `\n\n[Tappable follow-ups this answer offered: ${chips.map((chip) => JSON.stringify(chip)).join(" | ")}]` : ""}`;
}

export type ContextTurn = { role: "user" | "assistant"; content: string; choices?: string[] };

/** Keep both the task at the beginning and the question/offer at the end of a long turn. */
export function clipTurn(text: string, limit: number) {
  if (limit <= 0) return "";
  if (limit < 30) return text.slice(-limit);
  if (text.length <= limit) return text;
  const marker = "\n[…middle omitted…]\n";
  const head = Math.floor((limit - marker.length) / 2);
  return text.slice(0, head) + marker + text.slice(-(limit - marker.length - head));
}

export function recentContext(context: ContextTurn[], limit = 12000) {
  const turns = context.filter(turn => !turn.content.startsWith("Earlier conversation summary")).slice(-12);
  const selected: ContextTurn[] = [];
  for (let i = turns.length - 1; i >= 0 && limit > 0; i--) {
    const content = clipTurn(turns[i].role === "assistant" ? assistantConversationText(turns[i].content) : turns[i].content, Math.min(limit, turns[i].role === "assistant" ? 1800 : 1200));
    selected.unshift({role: turns[i].role, content, ...(turns[i].choices?.length ? {choices: turns[i].choices} : {})});
    limit -= content.length;
  }
  return selected;
}
