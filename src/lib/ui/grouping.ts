export type Group<T> = { label: string; items: T[] };

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
const DAY = 86_400_000;

/**
 * Groups items, newest first, into Today / Yesterday / Previous 7 days / Previous 30 days, then by month.
 * Uses the viewer's local calendar days, so "Today" means today for them.
 */
export function groupByRecency<T extends { updatedAt: string }>(items: T[], now = new Date()): Group<T>[] {
  const today = startOfDay(now);
  const groups: Group<T>[] = [];
  for (const item of items) {
    const when = new Date(item.updatedAt);
    const days = Math.round((today - startOfDay(when)) / DAY);
    const label = days <= 0 ? "Today" : days === 1 ? "Yesterday" : days <= 7 ? "Previous 7 days" : days <= 30 ? "Previous 30 days" : new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(when);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

/**
 * A long conversation renders only its newest `visible` messages. The rest stay in memory and are revealed on demand,
 * so the DOM stays small however long the conversation gets.
 */
export function windowMessages<T>(items: T[], visible: number) {
  const shown = items.slice(Math.max(0, items.length - visible));
  return { shown, hidden: items.length - shown.length, offset: items.length - shown.length };
}

export function greeting(hour: number) {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Case-insensitive filter that ignores accents and extra spaces. */
export function matchesQuery(text: string, query: string) {
  const normalize = (value: string) => value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const needle = normalize(query);
  return !needle || normalize(text).includes(needle);
}
