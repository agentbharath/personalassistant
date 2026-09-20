import Link from "next/link";
import { CalendarIcon, ClockIcon, WalletIcon } from "@/components/ui/icons";
import { eventWhen, shortDate, titleCase } from "@/components/today/format";
import { billsTotal, money, type WeeklySpending } from "@/lib/today/brief";
import type { DailyView, Section } from "@/lib/today/load";
import type { Bill } from "@/lib/agents/bills";
import styles from "./TodayView.module.css";

function Unavailable({ what, state }: { what: string; state: "needs_connection" | "unavailable" }) {
  return state === "needs_connection"
    ? <p className={styles.empty}>Connect Google in <Link className={styles.link} href="/settings">Settings</Link> to see {what}.</p>
    : <p className={styles.empty}>I couldn’t load {what} just now. Nothing was changed; try again in a moment.</p>;
}

function BillRows({ bills, showDue }: { bills: Bill[]; showDue: boolean }) {
  return <ul className={styles.rows}>{bills.map((bill) => <li className={styles.row} key={bill.id}>
    <span>{bill.merchant}</span><span>{money(bill.amountMinor, bill.currency)}{showDue && bill.dueDate ? ` · due ${shortDate(bill.dueDate)}` : ""}</span>
  </li>)}</ul>;
}

function Spending({ week }: { week: WeeklySpending }) {
  const change = week.changePercent;
  return <>
    <p className={styles.big}>{money(week.total, week.currency)}</p>
    <p className={styles.note}>{week.count} purchase{week.count === 1 ? "" : "s"} since {shortDate(week.from)} · about {money(week.dailyAverage, week.currency)} a day
      {change === null ? "" : <> · <span className={change > 0 ? styles.up : styles.down}>{change > 0 ? "up" : change < 0 ? "down" : "level"}{change === 0 ? "" : ` ${Math.abs(change)}%`}</span> on the week before ({money(week.previousTotal, week.currency)})</>}
    </p>
    <div className={styles.group}>
      <p className={styles.label}>Where it went</p>
      <ul className={styles.rows}>{week.topCategories.map((item) => <li className={styles.row} key={item.category}><span>{titleCase(item.category)}</span><span>{money(item.amountMinor, week.currency)} · {item.sharePercent}%</span></li>)}</ul>
    </div>
    {week.biggest && <p className={styles.note} style={{ marginTop: "var(--s-3)" }}>Biggest: {week.biggest.merchant}, {money(week.biggest.amountMinor, week.currency)} on {shortDate(week.biggest.occurredOn)}.</p>}
    {week.otherCurrencyCount > 0 && <p className={styles.note}>{week.otherCurrencyCount} purchase{week.otherCurrencyCount === 1 ? "" : "s"} in another currency {week.otherCurrencyCount === 1 ? "isn’t" : "aren’t"} included.</p>}
  </>;
}

const done = <T,>(part: Section<T>) => part.state === "ok";

export function TodayView({ view }: { view: DailyView }) {
  const heading = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${view.today}T00:00:00Z`));
  return (
    <div className={styles.page}>
      <p className={styles.eyebrow}>Today</p>
      <h1 className={styles.title}>{heading}</h1>
      <p className={styles.lede}>What’s on, what’s due, and how spending is going. Only you can see this.</p>
      <div className={styles.stack}>
        <section className={styles.card} aria-label="Meetings">
          <h2 className={styles.head}><CalendarIcon />Meetings</h2>
          {!done(view.meetingsToday) ? <Unavailable what="your meetings" state={(view.meetingsToday as { state: "needs_connection" | "unavailable" }).state} /> : <>
            <div className={styles.group}>
              <p className={styles.label}>Today</p>
              {view.meetingsToday.state === "ok" && view.meetingsToday.value.length
                ? <ul className={styles.rows}>{view.meetingsToday.value.map((event) => <li className={styles.row} key={event.id}><span>{event.summary}{event.location ? ` · ${event.location}` : ""}</span><span>{eventWhen(event, false)}</span></li>)}</ul>
                : <p className={styles.empty}>Nothing on your calendar today.</p>}
            </div>
            {view.meetingsAhead.state === "ok" && view.meetingsAhead.value.length > 0 && <div className={styles.group}>
              <p className={styles.label}>Coming up this week</p>
              <ul className={styles.rows}>{view.meetingsAhead.value.slice(0, 8).map((event) => <li className={styles.row} key={event.id}><span>{event.summary}</span><span>{eventWhen(event, true)}</span></li>)}</ul>
            </div>}
          </>}
        </section>

        <section className={styles.card} aria-label="Bills">
          <h2 className={styles.head}><ClockIcon />Bills to pay</h2>
          {view.bills.state !== "ok" ? <Unavailable what="your bills" state={view.bills.state} /> : (() => {
            const { overdue, dueToday, dueThisWeek, noDueDate } = view.bills.value;
            if (!overdue.length && !dueToday.length && !dueThisWeek.length && !noDueDate.length) return <p className={styles.empty}>No unpaid bills. Anything you paid is already counted in your spending.</p>;
            const total = billsTotal([...overdue, ...dueToday, ...dueThisWeek]);
            return <>
              {overdue.length > 0 && <div className={styles.group}><p className={`${styles.label} ${styles.late}`}>Overdue</p><BillRows bills={overdue} showDue /></div>}
              {dueToday.length > 0 && <div className={styles.group}><p className={styles.label}>Due today</p><BillRows bills={dueToday} showDue={false} /></div>}
              {dueThisWeek.length > 0 && <div className={styles.group}><p className={styles.label}>Due in the next 7 days</p><BillRows bills={dueThisWeek} showDue /></div>}
              {noDueDate.length > 0 && <div className={styles.group}><p className={styles.label}>No due date</p><BillRows bills={noDueDate} showDue={false} /></div>}
              {total && <p className={styles.note} style={{ marginTop: "var(--s-3)" }}>{money(total.amountMinor, total.currency)} to pay in all. Unpaid bills don’t count as spending until they’re paid. Tell Daylark “I paid the electric bill” to update them.</p>}
            </>;
          })()}
        </section>

        <section className={styles.card} aria-label="Spending this week">
          <h2 className={styles.head}><WalletIcon />Spending this week</h2>
          {view.spending.state !== "ok" ? <Unavailable what="your spending" state={view.spending.state} />
            : view.spending.value ? <Spending week={view.spending.value} />
            : <p className={styles.empty}>No spending recorded in the last 7 days. Tell Daylark what you spent, or ask it to import receipts from your email.</p>}
        </section>

      </div>
    </div>
  );
}
