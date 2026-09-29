import { compactDateLabel } from "@/lib/dates/display";
import { Button } from "@/components/ui/Button";
import type { BillsCardPayload } from "@/lib/chat/card-payload";
import styles from "./BillsCard.module.css";

const money = (amountMinor: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100);

/** The "what's due" card: hero total, the one bill to watch, a dated list of the rest, and a one-tap way to
 * mark the featured bill paid. Mirrors the anatomy of SpendingCard (eyebrow, hero, insight, list, actions). */
export function BillsCard({ payload, onFollowUp, busy }: { payload: BillsCardPayload; onFollowUp?: (text: string) => void; busy?: boolean }) {
  const { total, currency, count, insight, bills, moreCount, actions } = payload;

  return <section className={styles.card} aria-label={`Outstanding bills, ${count} bill${count === 1 ? "" : "s"}`}>
    <p className={styles.eyebrow}>{payload.periodLabel ? `Due · ${compactDateLabel(payload.periodLabel)}` : "Outstanding bills"}</p>
    <div className={styles.hero}>
      {total !== null && currency ? <p className={styles.big}>{money(total, currency)}</p> : <p className={styles.big}>{count}</p>}
      <span className={styles.count}>{count} bill{count === 1 ? "" : "s"}</span>
    </div>
    {insight && <p className={styles.insight}>{insight.replace(/ and (?:is )?not on autopay\./gi, ". Autopay status is unknown.")}</p>}

    <div className={styles.list}>{bills.map((bill) => <div className={styles.row} key={bill.id}>
      <span className={`${styles.badge} ${bill.overdue ? styles.badgeOverdue : ""}`}>
        {bill.badge ? <><span className={styles.weekday}>{bill.badge.weekday}</span><span className={styles.day}>{bill.badge.day}</span></> : <span className={styles.dash}>—</span>}
      </span>
      <span className={styles.info}>
        <span className={styles.merchant}>{bill.merchant}</span>
        <small className={bill.overdue ? styles.warn : bill.autopay ? styles.muted : styles.plain}>{bill.status}</small>
      </span>
      <span className={styles.amount}>{money(bill.amountMinor, bill.currency)}</span>
    </div>)}</div>
    {moreCount > 0 && <p className={styles.more}>+{moreCount} more bill{moreCount === 1 ? "" : "s"} not shown</p>}

    <p className={styles.foot}>Saved bills · autopay shown only when confirmed</p>
    {actions.length > 0 && <div className={styles.actions}>
      {actions.map((action, index) => <Button key={action.label} size="sm" variant={index === 0 ? "primary" : "secondary"} disabled={busy || !onFollowUp} onClick={() => onFollowUp?.(action.query)}>{action.label}</Button>)}
    </div>}
  </section>;
}
