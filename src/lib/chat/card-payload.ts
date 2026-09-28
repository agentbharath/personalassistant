/**
 * Some agent answers carry a rich card alongside their plain-text reply, instead of a migration adding a card
 * column: the payload rides as a trailing fenced block in the same stored/encrypted message content. Older
 * messages and any reader that doesn't know this convention see it as an ordinary (if odd-looking) code fence;
 * the chat UI strips it and renders the card instead. The prose before the fence is what "Copy answer" copies
 * and what a client that doesn't render cards falls back to, so it must stand alone.
 */
const FENCE = /\n*```daylark-card\n([\s\S]*?)\n```\s*$/;

export type SpendingCardPayload = {
  kind: "spending";
  periodLabel: string;
  filterLabel: string | null;
  currency: string;
  total: number;
  priorTotal: number;
  changePercent: number | null;
  comparisonLabel: string;
  insight: string;
  /** Cumulative running totals by day offset from the period start; `running.length` is the same for both periods (`priorPeriod` mirrors the current period's length). */
  running: { current: number; prior: number }[];
  /** Sparse labels for the x-axis -- one entry per tick, not one per day, so a month-long period doesn't render 30 crowded labels. */
  xTicks: { offset: number; label: string }[];
  /** Categories with a nonzero swing vs the prior period, largest absolute change first. */
  changes: { category: string; now: number; before: number; delta: number }[];
  topMerchants: { merchant: string; amountMinor: number; count: number }[];
  actions: { label: string; query: string }[];
  count: number;
  otherCurrencyCount: number;
};
export type BillsCardPayload = {
  kind: "bills";
  /** Null when the outstanding bills mix currencies -- adding them would be wrong, so the hero shows just the count. */
  total: number | null;
  currency: string | null;
  count: number;
  insight: string;
  /** Past-due first, then soonest due date first -- capped; `moreCount` covers the rest. */
  bills: { id: string; merchant: string; amountMinor: number; currency: string; badge: { weekday: string; day: number } | null; status: string; overdue: boolean; autopay: boolean }[];
  moreCount: number;
  actions: { label: string; query: string }[];
};
export type DayCardPayload = {
  kind: "day";
  dateLabel: string;
  count: number;
  insight: string;
  /** Today's timed meetings in order, with a "Free" row inserted for any gap of an hour or more between two of
   * them (no row before the first meeting or after the last -- there is no fixed workday boundary to measure
   * against). `past`/`startingSoon` are computed once, at answer time; like the rest of a chat message, this
   * reads as a snapshot of that moment, not a live view. */
  timeline: { time: string; label: string; duration: string | null; kind: "meeting" | "free" | "allday"; startingIn: string | null; past: boolean; location: string | null }[];
};
export type CardPayload = SpendingCardPayload | BillsCardPayload | DayCardPayload;

export function embedCard(text: string, payload: CardPayload): string {
  return `${text}\n\n\`\`\`daylark-card\n${JSON.stringify(payload)}\n\`\`\``;
}

const KNOWN_KINDS = new Set(["spending", "bills", "day"]);

/** Never throws: a malformed or unrecognized payload just means no card, the prose (unstripped) stands alone. */
export function extractCard(content: string): { text: string; card: CardPayload | null } {
  const match = content.match(FENCE);
  if (!match) return { text: content, card: null };
  try {
    const parsed = JSON.parse(match[1]) as { kind?: string };
    if (!parsed.kind || !KNOWN_KINDS.has(parsed.kind)) return { text: content, card: null };
    return { text: content.slice(0, match.index).trimEnd(), card: parsed as CardPayload };
  } catch {
    return { text: content, card: null };
  }
}
