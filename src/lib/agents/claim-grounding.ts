/**
 * Generalizes amount-grounding.ts's own principle (an amount is only used if the source actually shows it) from money specifically to any
 * cited number in a synthesized search answer: a sentence citing [n] for a specific figure (a year, a percentage, a price, a measurement)
 * should have that figure actually appear in source n's own evidence. Deterministic and code-only -- no extra model call, so it adds no
 * latency -- following the same reasoning that made the re-search loop (R43) fold its own check into the existing synthesis call rather
 * than add a new one.
 */
const NUMBER = /\d[\d,]*\.?\d*/g;

/** Every number a piece of text states, normalized (no thousands separators) so "5,088" and "5088" compare equal. */
function numbersIn(text: string): number[] {
  return [...text.matchAll(NUMBER)].map((match) => Number(match[0].replace(/,/g, ""))).filter((value) => Number.isFinite(value));
}

// A rounding or unit-precision difference ("29,032 ft" vs the source's own "29,031.7 ft") is not a wrong number; anything further off is.
const closeEnough = (claimed: number, available: number) => Math.abs(claimed - available) <= Math.max(1, available * 0.005);

// Sentence boundaries: a period/!/? followed by whitespace and a capital letter or digit -- approximate, but keeps a decimal ("5,088.5")
// from being split mid-number, which a naive split on "." alone would do.
const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).filter(Boolean);

/**
 * Strips a citation from any sentence where the number(s) it states are not actually present (within rounding) in the source(s) it cites.
 * An unverifiable citation is worse than none: it tells the reader a specific source backs a number that source doesn't contain. The
 * sentence itself is kept either way -- only the false attribution is removed, never the claim, which the evidence set as a whole may
 * still support even when one specific citation doesn't hold up to this check.
 */
export function groundCitedNumbers(answer: string, evidence: Array<{ snippet: string }>): string {
  return sentencesOf(answer).map((sentence) => {
    const cited = [...sentence.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])).filter((n) => n >= 1 && n <= evidence.length);
    if (!cited.length) return sentence;
    const claimed = numbersIn(sentence.replace(/\[\d+\]/g, ""));
    if (!claimed.length) return sentence;
    const available = cited.flatMap((n) => numbersIn(evidence[n - 1].snippet));
    const grounded = claimed.every((number) => available.some((source) => closeEnough(number, source)));
    return grounded ? sentence : sentence.replace(/\s?\[\d+\]/g, "");
  }).join(" ");
}
