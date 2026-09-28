import { money } from "@/lib/today/brief";
import { titleCase } from "@/components/today/format";
import type { SpendingCardPayload } from "@/lib/chat/card-payload";
import styles from "./SpendingCard.module.css";

/** Same anatomy as the "Spending this week" Today card (hero total, vs-prior pill, category bars, footer) --
 * for an arbitrary period instead of a fixed week, so the two read as the same design language. */
export function SpendingCard({ payload }: { payload: SpendingCardPayload }) {
  const { summary, periodLabel, filterLabel, insight } = payload;
  const change = summary.changePercent;
  return <section className={styles.card} aria-label={`Spending${filterLabel ? ` on ${filterLabel}` : ""}, ${periodLabel}`}>
    <p className={styles.eyebrow}>{periodLabel}{filterLabel ? ` · ${filterLabel.toUpperCase()}` : ""}</p>
    <div className={styles.hero}>
      <p className={styles.big}>{money(summary.total, summary.currency)}</p>
      {change !== null && <span className={`${styles.pill} ${change > 0 ? styles.pillWarn : styles.pillOk}`}>
        {change === 0 ? "Level with prior period" : `${change > 0 ? "▲" : "▼"} ${Math.abs(change)}% vs prior`}
      </span>}
    </div>
    {insight && <p className={styles.insight}>{insight}</p>}
    <div className={styles.cats}>{summary.categories.map((item) => <div className={styles.catRow} key={item.category}>
      <span className={styles.catHead}>
        <span className={styles.catName}>{titleCase(item.category)}</span>
        <span className={styles.catAmount}>{money(item.amountMinor, summary.currency)}</span>
      </span>
      <span className={styles.bar} aria-hidden="true"><span className={styles.fill} style={{ width: `${Math.max(item.sharePercent, 3)}%` }} /></span>
    </div>)}</div>
    <p className={styles.foot}>
      {summary.count} transaction{summary.count === 1 ? "" : "s"} · from your linked bank
      {summary.otherCurrencyCount > 0 ? ` · ${summary.otherCurrencyCount} in another currency not included` : ""}
    </p>
  </section>;
}
