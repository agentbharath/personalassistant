import { Temporal } from "@js-temporal/polyfill";

export type DateRange = { from: string; to: string };
export type FinancePeriod = { range: DateRange; prior: DateRange; label: string };

/** Resolve only a single, unqualified relative period. Complex/explicit dates stay with the query interpreter. */
export function resolveFinancePeriod(input: string, todayIso: string): FinancePeriod | null {
  if (/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\d{4}[-/]\d|\b\d{4}\b|\b\d+(?:st|nd|rd|th)\b/i.test(input)) return null;
  const matches = [...input.matchAll(/\b(this|last)\s+(week|month|year)\b|\b(?:last|past)\s+(\d{1,3})\s+days?\b|\b(today|yesterday)\b/gim)];
  if (matches.length !== 1 || /\b(?:since|until|before|after|between)\b/i.test(input)) return null;
  const remainder = input.replace(matches[0][0], "");
  if (/\b\d+\s*(?:[-–/]|to\b)|\bfrom\s+\d/i.test(remainder)) return null;
  const match = matches[0], today = Temporal.PlainDate.from(todayIso);
  const range = (start: Temporal.PlainDate, end: Temporal.PlainDate): DateRange => ({ from: start.toString(), to: end.toString() });
  if (match[3] || match[4]) {
    const count = match[3] ? Number(match[3]) : 1;
    if (count < 1) return null;
    const end = match[4]?.toLowerCase() === "yesterday" ? today.subtract({ days: 1 }) : today;
    const start = end.subtract({ days: count - 1 });
    return { range: range(start, end), prior: range(start.subtract({ days: count }), start.subtract({ days: 1 })), label: match[3] ? `Last ${count} days` : match[4]!.toLowerCase() === "today" ? "Today" : "Yesterday" };
  }
  const current = match[1].toLowerCase() === "this", unit = match[2].toLowerCase();
  if (unit === "week") {
    const monday = today.subtract({ days: today.dayOfWeek - 1 });
    const start = current ? monday : monday.subtract({ days: 7 });
    const end = current ? today : start.add({ days: 6 });
    return { range: range(start, end), prior: range(start.subtract({ days: 7 }), end.subtract({ days: 7 })), label: current ? "This week" : "Last week" };
  }
  const step = unit === "month" ? { months: 1 } : { years: 1 };
  const boundary = unit === "month" ? today.with({ day: 1 }) : today.with({ month: 1, day: 1 });
  const start = current ? boundary : boundary.subtract(step);
  const fullEnd = start.add(step).subtract({ days: 1 });
  const end = current ? today : fullEnd;
  const priorStart = start.subtract(step);
  // Whole calendar periods compare to whole periods. Partial periods compare the same dates, clamped for February/leap years.
  const priorEnd = end.equals(fullEnd) ? start.subtract({ days: 1 }) : end.subtract(step);
  return { range: range(start, end), prior: range(priorStart, priorEnd), label: current ? `This ${unit}` : `Last ${unit}` };
}
