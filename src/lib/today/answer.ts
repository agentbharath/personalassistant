import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent } from "@/lib/tools/calendar/google-calendar";
import { embedCard } from "@/lib/chat/card-payload";
import { billTotalsByCurrency, money } from "./brief";
import { buildDayCard } from "./day-card";
import { loadDailyView, type DailyView, type Section } from "./load";

const TIME_ZONE = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";
const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const shortDate = (iso: string) => Temporal.PlainDate.from(iso).toLocaleString("en-US", { month: "short", day: "numeric" });

function when(event: CalendarEvent, withDay: boolean) {
  if (event.allDay) return withDay ? `${shortDate(event.start)}, all day` : "all day";
  const at = Temporal.Instant.from(event.start).toZonedDateTimeISO(TIME_ZONE);
  const time = at.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  return withDay ? `${at.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${time}` : time;
}

const problem = (part: Section<unknown>, what: string) => part.state === "needs_connection"
  ? `I can't see ${what} because Google isn't connected. Connect it in Settings.`
  : `I couldn't load ${what} just now. Nothing was changed.`;

/**
 * R26: the daily view as a chat answer. It is the same data as the Perch page, written out, and no model reads or writes any of it.
 * `includeMeetings: false` drops the Meetings section -- used when a day card already covers it visually, so the
 * markdown underneath adds Bills/Spending rather than repeating the same meetings twice. The full text (this
 * default) is still what a non-card client or "Copy answer" without the card ever sees, so it's never optional
 * when there is no card to cover the gap.
 */
export function renderDailyView(view: DailyView, options?: { includeMeetings?: boolean }) {
  const includeMeetings = options?.includeMeetings ?? true;
  // The heading names the day, which the day card's own eyebrow already shows -- skip it here too, so the
  // remainder shown under that card doesn't repeat "Monday, September 28" right above "Bills to pay".
  const lines: string[] = includeMeetings ? [`### ${Temporal.PlainDate.from(view.today).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" })}`] : [];

  if (includeMeetings) {
    lines.push("", "**Meetings**", "");
    if (view.meetingsToday.state !== "ok") lines.push(problem(view.meetingsToday, "your meetings"));
    else {
      lines.push(...(view.meetingsToday.value.length ? view.meetingsToday.value.map((event) => `- ${when(event, false)} · ${event.summary}${event.location ? ` (${event.location})` : ""}`) : ["Nothing on your calendar today."]));
      if (view.meetingsAhead.state === "ok" && view.meetingsAhead.value.length) lines.push("", "_Coming up this week_", "", ...view.meetingsAhead.value.slice(0, 6).map((event) => `- ${when(event, true)} · ${event.summary}`));
    }
  }

  // R41: "what's my day look like" is scoped to today's things -- overdue and due-today bills (both a live problem as of today), never
  // a bill due later this week or beyond, which belongs to bills_list, not a day overview. Perch's own page is unaffected: it reads the
  // full bucket breakdown directly from `view.bills.value`, not this rendered text.
  lines.push("", "**Bills to pay**", "");
  if (view.bills.state !== "ok") lines.push(problem(view.bills, "your bills"));
  else {
    const { overdue, dueToday } = view.bills.value;
    const row = (label: string) => (bill: (typeof overdue)[number]) => `- ${bill.merchant}, ${money(bill.amountMinor, bill.currency)} · ${label}`;
    if (!overdue.length && !dueToday.length) lines.push("No bills due today.");
    else {
      lines.push(...overdue.map(row("overdue")), ...dueToday.map(row("due today")));
      const totals = billTotalsByCurrency([...overdue, ...dueToday]);
      for (const total of totals) lines.push("", `Total to pay (${total.currency}): **${money(total.amountMinor, total.currency)}**.`);
      lines.push("", "Unpaid bills don’t count as spending until they’re paid.");
    }
  }

  lines.push("", "**Spending today**", "");
  if (view.spendingToday.state !== "ok") lines.push(problem(view.spendingToday, "your spending"));
  else if (!view.spendingToday.value) lines.push("No spending recorded today.");
  else {
    const day = view.spendingToday.value;
    const change = day.changePercent === null ? "" : day.changePercent === 0 ? ", level with yesterday" : `, ${day.changePercent > 0 ? "up" : "down"} ${Math.abs(day.changePercent)}% on yesterday`;
    lines.push(`**${money(day.total, day.currency)}** across ${day.count} purchase${day.count === 1 ? "" : "s"}${change}.`,
      "", ...day.categories.slice(0, 4).map((item) => `- ${titleCase(item.category)}, ${money(item.amountMinor, day.currency)} (${item.sharePercent}%)`));
    if (day.biggest) lines.push("", `Biggest: ${day.biggest.merchant}, ${money(day.biggest.amountMinor, day.currency)}.`);
  }
  return lines.join("\n").replace(/^\n+/, "");
}

export async function answerDailyView(userId: string) {
  const view = await loadDailyView(userId);
  const card = buildDayCard(view);
  // When there's a card, it fully covers Meetings, so the markdown underneath (also shown, not just a copy
  // fallback) adds only what the card doesn't: Bills and Spending. Without one, the markdown is the whole answer.
  const text = renderDailyView(view, { includeMeetings: !card });
  return card ? embedCard(text, card) : text;
}
