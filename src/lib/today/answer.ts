import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent } from "@/lib/tools/calendar/google-calendar";
import { billsTotal, money } from "./brief";
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

/** R26: the daily view as a chat answer. It is the same data as the Perch page, written out, and no model reads or writes any of it. */
export function renderDailyView(view: DailyView) {
  const lines: string[] = [`### ${Temporal.PlainDate.from(view.today).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" })}`];

  lines.push("", "**Meetings**", "");
  if (view.meetingsToday.state !== "ok") lines.push(problem(view.meetingsToday, "your meetings"));
  else {
    lines.push(...(view.meetingsToday.value.length ? view.meetingsToday.value.map((event) => `- ${when(event, false)} · ${event.summary}${event.location ? ` (${event.location})` : ""}`) : ["Nothing on your calendar today."]));
    if (view.meetingsAhead.state === "ok" && view.meetingsAhead.value.length) lines.push("", "_Coming up this week_", "", ...view.meetingsAhead.value.slice(0, 6).map((event) => `- ${when(event, true)} · ${event.summary}`));
  }

  lines.push("", "**Bills to pay**", "");
  if (view.bills.state !== "ok") lines.push(problem(view.bills, "your bills"));
  else {
    const { overdue, dueToday, dueThisWeek, noDueDate } = view.bills.value;
    const row = (label: string) => (bill: (typeof overdue)[number]) => `- ${bill.merchant}, ${money(bill.amountMinor, bill.currency)}${label ? ` · ${label}` : bill.dueDate ? ` · due ${shortDate(bill.dueDate)}` : ""}`;
    if (!overdue.length && !dueToday.length && !dueThisWeek.length && !noDueDate.length) lines.push("No unpaid bills.");
    else {
      lines.push(...overdue.map(row("overdue")), ...dueToday.map(row("due today")), ...dueThisWeek.map(row("")), ...noDueDate.map(row("no due date")));
      const total = billsTotal([...overdue, ...dueToday, ...dueThisWeek]);
      if (total) lines.push("", `Total to pay: **${money(total.amountMinor, total.currency)}**. Unpaid bills don't count as spending until they're paid.`);
    }
  }

  lines.push("", "**Spending, last 7 days**", "");
  if (view.spending.state !== "ok") lines.push(problem(view.spending, "your spending"));
  else if (!view.spending.value) lines.push("No spending recorded in the last 7 days.");
  else {
    const week = view.spending.value;
    const change = week.changePercent === null ? "" : week.changePercent === 0 ? ", level with the week before" : `, ${week.changePercent > 0 ? "up" : "down"} ${Math.abs(week.changePercent)}% on the week before`;
    lines.push(`**${money(week.total, week.currency)}** across ${week.count} purchase${week.count === 1 ? "" : "s"}${change}.`,
      "", ...week.categories.slice(0, 4).map((item) => `- ${titleCase(item.category)}, ${money(item.amountMinor, week.currency)} (${item.sharePercent}%)`));
    if (week.biggest) lines.push("", `Biggest: ${week.biggest.merchant}, ${money(week.biggest.amountMinor, week.currency)} on ${shortDate(week.biggest.occurredOn)}.`);
  }
  return lines.join("\n");
}

export async function answerDailyView(userId: string) {
  return renderDailyView(await loadDailyView(userId));
}
