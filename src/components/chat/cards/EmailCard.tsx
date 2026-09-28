import type { EmailCardPayload } from "@/lib/chat/card-payload";
import styles from "./EmailCard.module.css";

/** The "anything important in my email" card: hero need-count, an insight naming what's urgent, the actual
 * highlighted messages, and a one-line summary of the rest. Mirrors SpendingCard/BillsCard/DayCard's anatomy. */
export function EmailCard({ payload }: { payload: EmailCardPayload }) {
  const { sinceLabel, totalCount, needCount, insight, highlights, othersCount, othersSummary } = payload;

  return <section className={styles.card} aria-label={`${sinceLabel}, ${totalCount} new, ${needCount} need${needCount === 1 ? "s" : ""} you`}>
    <p className={styles.eyebrow}>{sinceLabel} · {totalCount} new</p>
    <p className={styles.big}>{needCount} need{needCount === 1 ? "s" : ""} you</p>
    {insight && <p className={styles.insight}>{insight}</p>}

    {highlights.length > 0 && <div className={styles.list}>{highlights.map((item) => <div className={styles.row} key={item.id}>
      <span className={styles.avatar} aria-hidden="true">{item.initials}</span>
      <span className={styles.info}>
        <span className={styles.head}><span className={styles.sender}>{item.sender}</span><span className={styles.time}>{item.time}</span></span>
        <span className={styles.subject}>{item.subject}</span>
      </span>
      {item.hint && <span className={styles.tag}>{item.hint}</span>}
    </div>)}</div>}

    {othersCount > 0 && <p className={styles.others}>{othersCount} other{othersCount === 1 ? "" : "s"}{othersSummary ? `: ${othersSummary}` : ""}</p>}
  </section>;
}
