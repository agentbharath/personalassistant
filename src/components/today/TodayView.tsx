import Link from "next/link";
import type { ReactNode } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { CalendarIcon, CheckIcon, ClockIcon, WalletIcon } from "@/components/ui/icons";
import { eventWhen, shortDate, titleCase } from "@/components/today/format";
import { billsTotal, money, type WeeklySpending } from "@/lib/today/brief";
import type { DailyView } from "@/lib/today/load";
import type { Bill } from "@/lib/agents/bills";
import type { CalendarEvent } from "@/lib/tools/calendar/google-calendar";
import styles from "./TodayView.module.css";

type Tone = "blue" | "amber" | "green";

function Card({ label, tone, icon, badge, children }: { label: string; tone: Tone; icon: ReactNode; badge?: string; children: ReactNode }) {
  return <section className={styles.card} aria-label={label}>
    <header className={styles.head}>
      <span className={`${styles.chip} ${styles[tone]}`}>{icon}</span>
      <h2 className={styles.cardTitle}>{label}</h2>
      {badge && <span className={styles.badge}>{badge}</span>}
    </header>
    {children}
  </section>;
}

function Unavailable({ what, state }: { what: string; state: "needs_connection" | "unavailable" }) {
  return state === "needs_connection"
    ? <div className={styles.empty}><p>Connect Google to see {what}.</p><Link className={styles.action} href="/settings">Open Settings</Link></div>
    : <div className={styles.empty}><p>I couldn’t load {what} just now. Nothing was changed.</p></div>;
}

function Meetings({ events, withDay }: { events: CalendarEvent[]; withDay: boolean }) {
  return <ul className={styles.list}>{events.map((event) => <li className={styles.event} key={event.id}>
    <span className={styles.when}>{eventWhen(event, withDay)}</span>
    <span className={styles.what}>{event.summary}{event.location && <span className={styles.sub}>{event.location}</span>}</span>
  </li>)}</ul>;
}

function daysUntil(today: string, due: string) {
  return Temporal.PlainDate.from(due).since(Temporal.PlainDate.from(today), { largestUnit: "days" }).days;
}

function BillRows({ bills, today, kind }: { bills: Bill[]; today: string; kind: "overdue" | "today" | "soon" | "open" }) {
  return <ul className={styles.list}>{bills.map((bill) => {
    const days = bill.dueDate ? daysUntil(today, bill.dueDate) : null;
    const pill = kind === "overdue" ? { text: `${Math.abs(days ?? 0)} day${Math.abs(days ?? 0) === 1 ? "" : "s"} late`, tone: styles.pillAmber }
      : kind === "today" ? { text: "Due today", tone: styles.pillBlue }
      : kind === "soon" ? { text: `${bill.dueDate ? shortDate(bill.dueDate) : ""} · in ${days} day${days === 1 ? "" : "s"}`, tone: styles.pillPlain }
      : { text: "No due date", tone: styles.pillPlain };
    return <li className={styles.bill} key={bill.id}>
      <span className={styles.what}>{bill.merchant}<span className={`${styles.pill} ${pill.tone}`}>{pill.text}</span></span>
      <span className={styles.amount}>{money(bill.amountMinor, bill.currency)}</span>
    </li>;
  })}</ul>;
}

function Group({ label, tone, children }: { label: string; tone?: "late"; children: ReactNode }) {
  return <div className={styles.group}><p className={`${styles.label} ${tone === "late" ? styles.late : ""}`}>{label}</p>{children}</div>;
}

function Spending({ week }: { week: WeeklySpending }) {
  const change = week.changePercent;
  return <>
    <div className={styles.hero}>
      <p className={styles.big}>{money(week.total, week.currency)}</p>
      {change !== null && <span className={`${styles.pill} ${change > 0 ? styles.pillAmber : styles.pillGreen}`}>{change === 0 ? "Level with last week" : `${change > 0 ? "▲" : "▼"} ${Math.abs(change)}% vs last week`}</span>}
    </div>
    <p className={styles.sub}>{week.count} purchase{week.count === 1 ? "" : "s"} since {shortDate(week.from)} · about {money(week.dailyAverage, week.currency)} a day{change !== null && <> · last week {money(week.previousTotal, week.currency)}</>}</p>
    <Group label="Where it went">
      <div className={styles.cats}>{week.categories.map((item) => <details className={styles.catItem} key={item.category}>
        <summary className={styles.catSummary}>
          <span className={styles.catRow}>
            <span className={styles.catName}>{titleCase(item.category)}<span className={styles.sub}>{item.entries.length} purchase{item.entries.length === 1 ? "" : "s"}</span></span>
            <span className={styles.amount}>{money(item.amountMinor, week.currency)} <span className={styles.sub}>· {item.sharePercent}%</span></span>
          </span>
          <span className={styles.bar} aria-hidden="true"><span className={styles.fill} style={{ width: `${Math.max(item.sharePercent, 3)}%` }} /></span>
        </summary>
        <ul className={styles.entryList}>{item.entries.map((entry, index) => <li className={styles.entry} key={`${entry.occurredOn}-${entry.merchant}-${index}`}>
          <span className={styles.what}>{entry.merchant}<span className={styles.sub}>{shortDate(entry.occurredOn)}</span></span>
          <span className={styles.amount}>{money(entry.amountMinor, week.currency)}</span>
        </li>)}</ul>
      </details>)}</div>
    </Group>
    <div className={styles.foot}>
      {week.biggest && <p>Biggest: <strong>{week.biggest.merchant}</strong>, {money(week.biggest.amountMinor, week.currency)} on {shortDate(week.biggest.occurredOn)}</p>}
      {week.otherCurrencyCount > 0 && <p>{week.otherCurrencyCount} purchase{week.otherCurrencyCount === 1 ? "" : "s"} in another currency {week.otherCurrencyCount === 1 ? "isn’t" : "aren’t"} included.</p>}
    </div>
  </>;
}

export function TodayView({ view }: { view: DailyView }) {
  const heading = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${view.today}T00:00:00Z`));
  const meetings = view.meetingsToday, ahead = view.meetingsAhead, bills = view.bills, spending = view.spending;
  const billCount = bills.state === "ok" ? bills.value.overdue.length + bills.value.dueToday.length + bills.value.dueThisWeek.length : 0;

  return <div className={styles.page}>
    <p className={styles.eyebrow}>Your perch · your day at a glance</p>
    <h1 className={styles.title}>{heading}</h1>
    <p className={styles.lede}>From up here: what’s on, what’s due, and how spending is going. Only you can see this.</p>
    <div className={styles.stack}>
      <Card label="Meetings" tone="blue" icon={<CalendarIcon />} badge={meetings.state === "ok" ? (meetings.value.length ? `${meetings.value.length} today` : "Clear today") : undefined}>
        {meetings.state !== "ok" ? <Unavailable what="your meetings" state={meetings.state} /> : <>
          <Group label="Today">{meetings.value.length ? <Meetings events={meetings.value} withDay={false} /> : <p className={styles.quiet}>Nothing on your calendar today.</p>}</Group>
          {ahead.state === "ok" && ahead.value.length > 0 && <Group label="Coming up this week"><Meetings events={ahead.value.slice(0, 8)} withDay /></Group>}
        </>}
      </Card>

      <Card label="Bills to pay" tone="amber" icon={<ClockIcon />} badge={bills.state === "ok" ? (billCount ? `${billCount} due` : "Nothing due") : undefined}>
        {bills.state !== "ok" ? <Unavailable what="your bills" state={bills.state} /> : (() => {
          const { overdue, dueToday, dueThisWeek, noDueDate } = bills.value;
          if (!overdue.length && !dueToday.length && !dueThisWeek.length && !noDueDate.length) return <p className={styles.allClear}><CheckIcon />No unpaid bills. Anything you paid is already counted in your spending.</p>;
          const total = billsTotal([...overdue, ...dueToday, ...dueThisWeek]);
          return <>
            {overdue.length > 0 && <Group label="Overdue" tone="late"><BillRows bills={overdue} today={view.today} kind="overdue" /></Group>}
            <Group label="Due today">{dueToday.length ? <BillRows bills={dueToday} today={view.today} kind="today" /> : <p className={styles.quiet}>Nothing due today.</p>}</Group>
            <Group label="Coming up this week">{dueThisWeek.length ? <BillRows bills={dueThisWeek} today={view.today} kind="soon" /> : <p className={styles.quiet}>Nothing due in the next 7 days.</p>}</Group>
            {noDueDate.length > 0 && <Group label="No due date"><BillRows bills={noDueDate} today={view.today} kind="open" /></Group>}
            <div className={styles.foot}>
              {total && <p className={styles.footRow}><span>To pay in all</span><strong>{money(total.amountMinor, total.currency)}</strong></p>}
              <p>Unpaid bills don’t count as spending until they’re paid. Tell Daylark “I paid the electric bill” to update them.</p>
            </div>
          </>;
        })()}
      </Card>

      <Card label="Spending this week" tone="green" icon={<WalletIcon />}>
        {spending.state !== "ok" ? <Unavailable what="your spending" state={spending.state} />
          : spending.value ? <Spending week={spending.value} />
          : <div className={styles.empty}><p>No spending recorded in the last 7 days. Tell Daylark what you spent, or ask it to import receipts from your email.</p></div>}
      </Card>
    </div>
  </div>;
}
