/**
 * Some agent answers carry a rich card alongside their plain-text reply, instead of a migration adding a card
 * column: the payload rides as a trailing fenced block in the same stored/encrypted message content. Older
 * messages and any reader that doesn't know this convention see it as an ordinary (if odd-looking) code fence;
 * the chat UI strips it and renders the card instead. The prose before the fence is what "Copy answer" copies
 * and what a client that doesn't render cards falls back to, so it must stand alone.
 */
const FENCE = /```daylark-card\n([\s\S]*?)\n```/g;

export type SpendingCardPayload = {
  kind: "spending";
  empty?: boolean;
  periodLabel: string;
  filterLabel: string | null;
  currency: string;
  total: number;
  priorTotal: number;
  priorPeriodLabel?: string;
  changePercent: number | null;
  comparisonLabel: string;
  insight: string;
  /** Cumulative running totals by day offset from the period start; `running.length` is the same for both periods (`priorPeriod` mirrors the current period's length). Empty for a longer period (see `categories`) -- a daily running total over a month is mostly flat days and a few spikes, which reads as a broken staircase rather than a useful chart. */
  running: { current: number; prior: number }[];
  /** Sparse labels for the x-axis -- one entry per tick, not one per day, so a month-long period doesn't render 30 crowded labels. */
  xTicks: { offset: number; label: string }[];
  /** Categories with a nonzero swing vs the prior period, largest absolute change first. Empty for a longer period (see `categories`). */
  changes: { category: string; now: number; before: number; delta: number }[];
  topMerchants: { merchant: string; amountMinor: number; count: number }[];
  /** The plain category breakdown (share of the period's total), used instead of running/changes/topMerchants for a period longer than about a week or a single-category filter, where a running-total chart and a week-over-week category diff both stop being meaningful. Empty for the shorter/richer view. */
  categories: { category: string; amountMinor: number; sharePercent: number }[];
  actions: { label: string; query: string }[];
  count: number;
  otherCurrencyCount: number;
};
export type BillsCardPayload = {
  kind: "bills";
  periodLabel?: string;
  /** Null when the outstanding bills mix currencies -- adding them would be wrong, so the hero shows just the count. */
  total: number | null;
  currency: string | null;
  count: number;
  insight: string;
  /** Past-due first, then soonest due date first -- capped; `moreCount` covers the rest. */
  bills: { id: string; merchant: string; amountMinor: number; currency: string; badge: { weekday: string; day: number } | null; status: string; overdue: boolean; autopay: boolean | null }[];
  moreCount: number;
  actions: { label: string; query: string }[];
};
export type DayCardPayload = {
  kind: "day";
  nowMarker?: { index: number; label: string };
  asOf?: string;
  dateLabel: string;
  count: number;
  insight: string;
  /** True when this card is the whole answer (calendar_query, any single day asked about) -- false for daily_view,
   * whose card only covers Meetings, with Bills/Spending still shown as markdown below it. Only daily_view's
   * false case should also render that trailing markdown; a standalone card would just be duplicating itself. */
  standalone: boolean;
  /** Today's timed meetings in order, with a "Free" row inserted for any gap of an hour or more between two of
   * them (no row before the first meeting or after the last -- there is no fixed workday boundary to measure
   * against). `past`/`startingSoon` are computed once, at answer time; like the rest of a chat message, this
   * reads as a snapshot of that moment, not a live view. */
  timeline: { time: string; label: string; duration: string | null; kind: "meeting" | "free" | "allday"; startingIn: string | null; past: boolean; location: string | null }[];
};
export type EmailCardPayload = {
  kind: "email";
  sinceLabel: string;
  totalCount: number;
  needCount: number;
  insight: string;
  /** The action items to show in full, capped; needCount is the true total, which may exceed highlights.length. */
  highlights: { id: string; sender: string; initials: string; subject: string; time: string; hint: string }[];
  /** Everything that did NOT need action -- always totalCount - needCount, independent of the highlights cap. */
  othersCount: number;
  othersSummary: string;
};
export type RecallAvailabilityCardPayload = {
  kind: "recall-availability";
  headline: string;
  /** Null when the time couldn't be resolved (an ask/unavailable reading) -- that half falls back to plain text. */
  availability: {
    dateLabel: string;
    note: string;
    free: boolean;
    /** Chronological, spanning the whole asked-about window (unlike the day card's meetings-only timeline: "is Friday evening free" needs the full window's shape, not just gaps between events). */
    segments: { kind: "free" | "busy"; label: string; widthPercent: number }[];
    ticks: string[];
  } | null;
  /** Null when nothing relevant was found at all (no saved search to fall back on either) -- that half falls back to plain text. */
  recall: {
    question: string;
    note: string;
    /** A place already resolved from conversation text (someone was actually recommended it, not just found in a search) -- shown as a plain answer, no picker. */
    resolvedName: string | null;
    /** Only populated when resolvedName is null: the saved search's own results, for the person to pick from. */
    candidates: { id: string; name: string }[];
    moreCount: number;
  } | null;
  /** Follow-up query templates with a literal "{name}" the client fills in from the chosen candidate. */
  planQuery: string;
  noneQuery: string;
};
export type WeatherCardPayload = {
  kind: "weather";
  appearance?: "sun" | "cloud" | "rain" | "snow" | "fog" | "night";
  hourlyLabel?: string;
  eyebrow: string; // "Now · Sunnyvale" / "Tomorrow · 6 to 8 AM" / "Thursday · chance of rain" / "Tonight · Sunnyvale"
  /** A temperature reading ("77°") normally; a plain "Yes"/"No" when the request was a yes/no rain/snow question (weatherYesNo). */
  headline: string;
  condition: string; // "Sunny" / "Fog" / "Rain, 2 to 7 PM" / "Clear"
  insight: string;
  rangeLow: number;
  rangeHigh: number;
  /** Where the current/representative reading sits within [rangeLow, rangeHigh], for the slider dot -- same unit as headline's number, ignored when headline isn't a temperature. */
  current: number;
  hourly: { label: string; value: number; highlighted: boolean }[];
  /** Which quantity `hourly.value` holds -- temperature (°) normally, precipitation chance (%) for a yes/no rain question, since that's the number that actually answers it. */
  hourlyUnit: "temp" | "precip";
  /** Exactly 3, chosen for what's actually relevant to this question (wind/UV/humidity normally; visibility/wind/humidity for fog; total precipitation/wind/gusts for a rain yes/no; wind/humidity/sunrise for tonight). */
  stats: { label: string; value: string }[];
  attribution: string; // "open-meteo.com · updated just now"
};
export type StockCardPayload = {
  kind: "stock";
  eyebrow: string; // "AAPL · Apple Inc"
  headline: string; // "$254.32"
  changeLabel: string; // "+$1.24 (0.49%)" / "-$3.10 (1.2%)"
  changeDirection: "up" | "down" | "flat";
  insight: string;
  rangeLow: number; // the day's low
  rangeHigh: number; // the day's high
  /** Where the current price sits within [rangeLow, rangeHigh], for the range bar's dot. */
  current: number;
  isMarketOpen: boolean;
  /** Exactly 3: previous close, volume, exchange. */
  stats: { label: string; value: string }[];
  attribution: string; // "twelvedata.com · updated just now"
};
/** One side of a head-to-head event -- a team/side's own name and score for one game. */
export type SportsSide = { name: string; score: string; detail: string; winner: boolean };
export type SportsCardPayload = {
  kind: "sports";
  kindLabel: string; // "NFL score" / "Cricket score" -- header, sentence case
  freshness: string; // header right: "Just now" / "As of Sep 29, 9:40 AM"
  /** One optional line of prose framing, shown above the event box -- "Their next match is at home against Denver." for a scheduled
   * game with nothing else to show, "" when the event box (or its own outcome line) already says everything. */
  summary: string;
  eventLabel: string; // "NFL · Week 4 · Levi's Stadium" / "Cricket · 1st ODI · Thiruvananthapuram" -- the event box's own left line
  statusTag: { label: string; tone: "good" | "highlight" | "neutral" | "catch" | "live" };
  /** A decided game (final or in-progress) gets the head-to-head event box; a still-scheduled one with nothing to score yet gets the
   * simpler upcoming-game tile instead -- there is nothing to put in a score row before the game starts. */
  event: { final: boolean; sides: [SportsSide, SportsSide]; outcome: string } | null;
  upcoming: { month: string; day: string; matchup: string; detail: string } | null;
  attribution: string; // footer: "espn.com"
};
/** The one-match score card (cricket is the reference layout): a scoreboard, the result or live chase under it, stat tables, match facts,
 * sources and follow-up chips. Covers a finished, live or disrupted match; a not-yet-started one stays a SportsCardPayload upcoming tile,
 * since there is nothing to put on a scoreboard before the game starts. */
export type ScoreTeam = { name: string; score: string; detail: string; /** The winner, or the batting side while live. */ lead: boolean };
export type ScoreCardPayload = {
  kind: "score";
  match: string; // "1st ODI, Thiruvananthapuram · Sep 27"
  status: { label: string; tone: "final" | "live" | "upcoming" | "disrupted" };
  teams: [ScoreTeam, ScoreTeam];
  /** Under the scoreboard: a finished match's result ("India won by 8 wickets" / "with 50 balls left"), or a live chase ("India need 34
   * from 60 balls" with current/required run rate). Null when ESPN has nothing to say. */
  outcome: { kind: "result" | "chase"; text: string; detail: string; rates: string[] } | null;
  tables: { title: string; columns: string[]; rows: { player: string; side: string; stats: string[] }[] }[];
  facts: { label: string; value: string }[];
  sources: { label: string; url: string }[];
  /** `url` opens a real page; `text` is sent as a follow-up message; `act` marks the one that hands off to another agent (blue). */
  chips: { label: string; url?: string; text?: string; act?: boolean }[];
};
/** A tone tag used across the answer-card family: good = green, highlight = blue, neutral = gray, catch = amber. */
export type CardTag = { label: string; tone: "good" | "highlight" | "neutral" | "catch" };
export type SuggestionRow = { name: string; meta: string; metric: string; roleTag: CardTag };
export type SuggestionCardPayload = {
  kind: "suggestion";
  kindLabel: string; // "Men's fleece jackets, size M" -- header, sentence case
  freshness: string; // "Prices as of 2:14 PM"
  topPick: { name: string; meta: string; metric: string; edgeTag: CardTag | null; reason: string; actionLabel: string; actionUrl: string };
  /** 1 to 3 more options, each with its own single verdict tag -- never the top pick repeated. */
  rows: SuggestionRow[];
  limit: string; // "Coupons, member prices and cashback aren't included. Confirm size M is in stock at checkout."
  sources: { label: string; url: string }[];
  /** Up to 4 tap-to-send follow-ups this specific answer suggests, decided by the same extraction that built the card -- never inferred
   * generically from the answer's kind (see chat/types.ts's own `followUps`, deliberately a no-op for exactly that reason). */
  chips: string[];
};
export type CardPayload = SpendingCardPayload | BillsCardPayload | DayCardPayload | EmailCardPayload | RecallAvailabilityCardPayload | WeatherCardPayload | StockCardPayload | SportsCardPayload | ScoreCardPayload | SuggestionCardPayload;

export function embedCard(text: string, payload: CardPayload): string {
  return `${text}\n\n\`\`\`daylark-card\n${JSON.stringify(payload)}\n\`\`\``;
}

const KNOWN_KINDS = new Set(["spending", "bills", "day", "email", "recall-availability", "weather", "stock", "sports", "score", "suggestion"]);

export type CardSegment = { text: string; card: CardPayload | null };

/**
 * Never throws. One or more answers, each already embedCard'ed on its own, can end up joined into one message
 * (a multi-part search, several agents in one "multi" turn) -- found live: a card's own fence is only ever at
 * the very end of ITS answer, never of the joined whole, so a single-card-anchored extraction could only ever
 * find the LAST fence, leaving every earlier card's raw JSON sitting in the "text" as literal, visible text.
 * Finds every fence anywhere in the content instead, pairing each with the prose that led into it, in order --
 * this is also the shape a genuinely compound answer ("what's the weather and how's AAPL doing") needs: each
 * sub-answer's own text stays next to its own card, not all the text lumped above all the cards.
 * A malformed or unrecognized fence degrades to plain text for just that one segment, never the whole message.
 */
export function extractCards(content: string): { text: string; segments: CardSegment[] } {
  const segments: CardSegment[] = [];
  let cursor = 0;
  for (const match of content.matchAll(FENCE)) {
    const before = content.slice(cursor, match.index).trim();
    let card: CardPayload | null = null;
    try {
      const parsed = JSON.parse(match[1]) as { kind?: string };
      if (parsed.kind && KNOWN_KINDS.has(parsed.kind)) card = parsed as CardPayload;
    } catch { /* malformed: this segment's own text still stands, just with no card */ }
    // A fence whose card didn't parse/recognize is kept as literal text (the same "unstripped" fallback the
    // single-card version always had), rejoined onto this segment's own leading prose rather than dropped.
    segments.push(card ? { text: before, card } : { text: content.slice(cursor, match.index + match[0].length).trim(), card: null });
    cursor = match.index! + match[0].length;
  }
  const trailing = content.slice(cursor).trim();
  if (trailing || segments.length === 0) segments.push({ text: trailing, card: null });
  const text = segments.map((segment) => segment.text).filter(Boolean).join("\n\n");
  return { text, segments };
}
