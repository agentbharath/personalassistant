import { Temporal } from "@js-temporal/polyfill";

/** Inclusive date-only ranges. Keep the year once, except across a year boundary. */
export function formatDateRange(from: string, to: string): string {
  const start = Temporal.PlainDate.from(from), end = Temporal.PlainDate.from(to);
  const short = (date: Temporal.PlainDate) => date.toLocaleString("en-US", { month: "short", day: "numeric" });
  if (start.equals(end)) return `${short(start)}, ${start.year}`;
  if (start.year !== end.year) return `${short(start)}, ${start.year} – ${short(end)}, ${end.year}`;
  if (start.month === end.month) return `${short(start)}–${end.day}, ${start.year}`;
  return `${short(start)} – ${short(end)}, ${start.year}`;
}

/** Also tidy date labels already saved in earlier chat cards; leave natural-language labels alone. */
export function compactDateLabel(label: string): string {
  const iso = label.match(/^(\d{4}-\d{2}-\d{2})\s*[–—]\s*(\d{4}-\d{2}-\d{2})$/);
  const verbose = label.match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})\s*[–—]\s*([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
  try {
    if (iso) return formatDateRange(iso[1], iso[2]);
    if (verbose) {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const date = (month: string, day: string, year: string) => `${year}-${String(months.indexOf(month) + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
      return formatDateRange(date(verbose[1], verbose[2], verbose[3]), date(verbose[4], verbose[5], verbose[6]));
    }
  } catch { /* Unknown legacy labels remain readable as stored. */ }
  return label;
}
