export type OrdinalReference =
  | { action: "import" | "facts" | "show"; index: number }
  | { ask: "which" }
  | { outOfRange: number };

const ORDINALS: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5, top: 1 };
const NOUN = /\b(?:one|email|message|receipt|order|invoice|result|item|option)s?\b/i;
const OTHER_DOMAIN = /\b(?:calendar|meeting|appointment|spend|spent|spending|transactions?)\b/i;

function actionOf(text: string): "import" | "facts" | "show" {
  if (/\b(?:import|record|save|add)\b/i.test(text)) return "import";
  if (/\b(?:amount|total|how much|cost|charged|paid|billing date|bill date|due)\b/i.test(text)) return "facts";
  return "show";
}

const time = (date: string) => (Number.isNaN(Date.parse(date)) ? 0 : Date.parse(date));

/**
 * R13: "import the second one", "#3", "the latest one", "how much was the first", "show me that one".
 * `results` is the numbered list from the last email answer (saved state).
 */
export function parseOrdinalReference(input: string, results: Array<{ date: string }>): OrdinalReference | null {
  const text = input.trim();
  if (text.length > 90 || OTHER_DOMAIN.test(text)) return null;
  const action = actionOf(text);

  let index: number | null = null;
  const hash = text.match(/(?:#|\b(?:number|no\.?|item|result|option)\s*)(\d{1,2})\b/i);
  const word = text.match(/\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|top)\b/i);
  if (hash) index = Number(hash[1]) - 1;
  else if (word && (NOUN.test(text) || /\b(?:import|show|open|read|record|save)\b/i.test(text))) index = ORDINALS[word[1].toLowerCase()] - 1;
  else if (/\b(?:the )?last(?: one)?\b/i.test(text) && NOUN.test(text)) index = results.length - 1;
  else if (/\b(?:latest|newest|most recent)\b/i.test(text) && /\bone\b/i.test(text)) index = results.reduce((best, item, i) => (time(item.date) > time(results[best].date) ? i : best), 0);
  else if (/\boldest\b/i.test(text) && /\bone\b/i.test(text)) index = results.reduce((best, item, i) => (time(item.date) < time(results[best].date) ? i : best), 0);
  else if (/\b(?:that|this) one\b/i.test(text) || /^(?:import|show|open|read|record|save)\s+(?:me\s+)?(?:it|that|this)$/i.test(text)) {
    return results.length === 1 ? { action, index: 0 } : { ask: "which" };
  }
  if (index === null) return null;
  return index >= 0 && index < results.length ? { action, index } : { outOfRange: results.length };
}
