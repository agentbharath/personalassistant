/**
 * A model reads the amount off a receipt, and a model can be wrong: it once returned 2,026.00 for a $152.72 hotel stay by taking the year in
 * "Sep 6, 2026" for money. So an amount is only used if the email itself shows it as money. Code checks this; it never decides what an email means.
 */
const CURRENCY = String.raw`(?:US\$|CA\$|\$|USD\s?|CAD\s?|EUR\s?|GBP\s?|INR\s?|Rs\.?\s?|€|£|₹)`;
const WHOLE = String.raw`\d{1,3}(?:,\d{3})+|\d+`;
// A currency mark and then an amount ("$152.72", "USD 20", "$2,026"), or a bare number that has exactly two decimals ("152.72").
const MARKED = new RegExp(String.raw`${CURRENCY}\s?(${WHOLE})(?:\.(\d{1,2}))?(?![\d])`, "gi");
const DECIMAL = new RegExp(String.raw`(?<![\d.,])(${WHOLE})\.(\d{2})(?![\d])`, "g");

/** Every amount the text shows as money, in minor units (cents). A year, a date, an order number or a phone number is not one. */
export function moneyAmountsIn(text: string): Set<number> {
  const found = new Set<number>();
  for (const pattern of [MARKED, DECIMAL]) {
    for (const match of text.matchAll(pattern)) {
      const whole = Number(match[1].replace(/,/g, ""));
      const cents = match[2] === undefined ? 0 : Number(match[2].padEnd(2, "0"));
      if (Number.isFinite(whole)) found.add(whole * 100 + cents);
    }
  }
  return found;
}

/** The model's amount if the email shows it as money; otherwise the amount read by plain rules (which came from the text), or null. */
export function groundAmount(modelMinor: number | null | undefined, text: string, ruleMinor: number | null): number | null {
  const shown = moneyAmountsIn(text);
  if (modelMinor && shown.has(modelMinor)) return modelMinor;
  if (ruleMinor && shown.has(ruleMinor)) return ruleMinor;
  return null;
}
