import type { Learning, Learnings } from "./learnings";

// ---------- R14.4: fixed category set ----------
export const CATEGORIES = ["restaurants", "groceries", "transport", "shopping", "utilities", "entertainment", "health", "housing", "other"] as const;
const SYNONYMS: Record<string, (typeof CATEGORIES)[number]> = {
  restaurant: "restaurants", restaurants: "restaurants", food: "restaurants", dining: "restaurants", "eating out": "restaurants", takeout: "restaurants",
  grocery: "groceries", groceries: "groceries",
  transport: "transport", transportation: "transport", travel: "transport", gas: "transport", fuel: "transport", commute: "transport",
  shopping: "shopping", retail: "shopping", clothes: "shopping", clothing: "shopping",
  utilities: "utilities", utility: "utilities", bills: "utilities", bill: "utilities",
  entertainment: "entertainment", fun: "entertainment", streaming: "entertainment", movies: "entertainment",
  health: "health", medical: "health", wellness: "health", supplements: "health", fitness: "health", pharmacy: "health",
  housing: "housing", rent: "housing", mortgage: "housing", home: "housing",
  other: "other", misc: "other", miscellaneous: "other",
};
export function normalizeCategory(word: string) {
  return SYNONYMS[word.trim().toLowerCase().replace(/^(?:a|an|my|the)\s+/, "")] ?? null;
}

/** R14.4: any free-form category ("Health & Wellness", "Health & Supplements") becomes one from the fixed set. */
export function toKnownCategory(value: string): string {
  const lower = value.trim().toLowerCase();
  if (!lower) return "other";
  if (/\b(?:income|salary|paycheck|refund|deposit)\b/.test(lower)) return "income";
  const direct = normalizeCategory(lower);
  if (direct) return direct;
  for (const token of lower.split(/[^a-z]+/)) {
    const category = SYNONYMS[token];
    if (category) return category;
  }
  return "other";
}

// Ordered: the first match wins, so "uber eats" is checked before "uber". Deterministic, and always overridden by a learned category.
const MERCHANT_CATEGORIES: Array<[RegExp, (typeof CATEGORIES)[number]]> = [
  [/doordash|uber ?eats|grubhub|postmates|seamless|caviar|chipotle|starbucks|mcdonald|dunkin|restaurant|cafe|coffee|pizza|kitchen|grill|bistro|diner|bakery/i, "restaurants"],
  [/instacart|safeway|kroger|whole foods|trader joe|aldi|albertsons|sprouts|grocery|supermarket/i, "groceries"],
  [/uber|lyft|parking|clipper|bart\b|chevron|shell|exxon|airlines?|united|delta|southwest|amtrak|greyhound|fuel|gas station/i, "transport"],
  [/pg&e|pge\b|pacific gas|comcast|xfinity|at&t|verizon|t-mobile|conservice|water|electric|utility|utilities|internet/i, "utilities"],
  [/netflix|spotify|hulu|disney|cinemark|\bamc\b|regal|ticketmaster|seatgeek|stubhub|steam|playstation|xbox|nintendo|google play|apple music|youtube/i, "entertainment"],
  [/cvs|walgreens|pharmacy|clinic|dental|dentist|medical|hospital|urgent care|optometr|vision/i, "health"],
  [/apartments?|property|properties|rent\b|leasing|mortgage|landlord|realty|heritage park/i, "housing"],
];

/** A best-effort category from the merchant's name, or null when nothing is recognisable. */
export function guessCategory(merchant: string): (typeof CATEGORIES)[number] | null {
  return MERCHANT_CATEGORIES.find(([pattern]) => pattern.test(merchant))?.[1] ?? null;
}

const NOT_A_MERCHANT = /^(?:it|that|this|these|those|what|who|which|where|how|there|everything|anything|something|my|the|i|we|you|he|she|they|today|tomorrow|yesterday|spending|money|life|all|each|every|one|nothing)$/i;
const clean = (value: string) => value.trim().replace(/[.!?]+$/, "").replace(/^["“'‘]+|["”'’]+$/g, "").trim();
const bare = (value: string) => clean(value).replace(/^(?:my|the)\s+/i, "");
const words = (value: string) => value.split(/\s+/).filter(Boolean);

export type FinanceCorrection = Learning | { unknownCategory: string; merchant: string };

/** R14.2, R14.3: "iherb is health", "categorize Curry Point as restaurants", "amzn means Amazon". */
export function detectFinanceCorrection(input: string): FinanceCorrection | null {
  const text = input.trim();
  if (text.length > 70 || text.includes("?")) return null;
  const explicit = text.match(/^(?:please\s+)?(?:categori[sz]e|put|file|treat|count|mark)\s+(.{2,40}?)\s+(?:as|under|in|to be)\s+(?:a\s+|an\s+)?(.{3,24}?)[.!]*$/i);
  if (explicit) {
    const merchant = bare(explicit[1]);
    if (!merchant || NOT_A_MERCHANT.test(merchant) || words(merchant).length > 3) return null;
    const category = normalizeCategory(clean(explicit[2]));
    return category ? { kind: "merchant_category", merchant, category } : { unknownCategory: clean(explicit[2]), merchant };
  }
  const alias = text.match(/^(.{2,30}?)\s+(?:means|stands for|is short for|is the same as)\s+(.{2,30}?)[.!]*$/i);
  if (alias) {
    const from = clean(alias[1]);
    const to = clean(alias[2]);
    if (from && to && from.toLowerCase() !== to.toLowerCase() && words(from).length <= 3 && words(to).length <= 3 && !NOT_A_MERCHANT.test(from)) return { kind: "merchant_alias", alias: from, canonical: to };
    return null;
  }
  const implicit = text.match(/^(.{2,40}?)\s+(?:is|are|should be|counts as|goes (?:under|in))\s+(?:a\s+|an\s+|my\s+)?([a-z ]{3,20}?)(?:\s+(?:expense|spending|purchase|category))?[.!]*$/i);
  if (implicit) {
    const merchant = bare(implicit[1]);
    const category = normalizeCategory(implicit[2]);
    if (category && merchant && !NOT_A_MERCHANT.test(merchant) && words(merchant).length <= 3) return { kind: "merchant_category", merchant, category };
  }
  return null;
}

/** R14.2: alias first, then category, on any new record or import preview. */
export function applyMerchantLearnings<T extends { merchant: string; category: string }>(candidate: T, learnings: Learnings) {
  const original = candidate.merchant;
  const merchant = learnings.merchantAliases[original.toLowerCase()] ?? original;
  const learned = learnings.merchantCategories[merchant.toLowerCase()] ?? learnings.merchantCategories[original.toLowerCase()];
  const category = learned ?? toKnownCategory(candidate.category);
  return { candidate: { ...candidate, merchant, category }, renamed: merchant !== original, recategorized: learned !== undefined && learned !== candidate.category };
}

// ---------- R14.1: calendar ----------
const CUE = /\b(?:always|by default|default|from now on|going forward)\b/i;
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty-five": 45, sixty: 60, ninety: 90 };

function minutesIn(text: string) {
  if (/\bhalf an? hour\b/i.test(text)) return 30;
  const match = text.match(/\b(\d{1,3}|a|an|one|two|three|four|five|six|ten|fifteen|twenty|thirty|forty|forty-five|sixty|ninety)\s*[- ]?(minutes?|mins?|hours?|hrs?)\b/i);
  if (!match) return null;
  const count = NUMBER_WORDS[match[1].toLowerCase()] ?? Number(match[1]);
  return /^h/i.test(match[2]) ? count * 60 : count;
}

export function detectCalendarPreference(input: string): Learning | null {
  const text = input.trim();
  if (text.length > 100 || text.includes("?") || !CUE.test(text)) return null;
  const minutes = minutesIn(text);
  if (minutes === null) return null;
  if (/\b(?:buffer|cushion|padding|extra time|travel time)\b/i.test(text)) return minutes >= 5 && minutes <= 120 ? { kind: "calendar_buffer", minutes } : null;
  if (/\b(?:meetings?|events?|appointments?|calls?|length|duration|long)\b/i.test(text)) return minutes >= 5 && minutes <= 480 ? { kind: "calendar_duration", minutes } : null;
  return null;
}
