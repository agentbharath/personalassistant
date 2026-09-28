import type { DayCardPayload } from "@/lib/chat/card-payload";
import styles from "./DayCard.module.css";

/** The "what does my day look like" card: hero meeting count, a busy/free read of the day, and a timeline of
 * today's meetings with any hour-plus gap called out as free time. Mirrors SpendingCard/BillsCard's anatomy. */
export function DayCard({ payload }: { payload: DayCardPayload }) {
  const { dateLabel, count, insight, timeline } = payload;

  return <section className={styles.card} aria-label={`${dateLabel}, ${count} meeting${count === 1 ? "" : "s"}`}>
    <p className={styles.eyebrow}>{dateLabel}</p>
    <p className={styles.big}>{count} meeting{count === 1 ? "" : "s"}</p>
    {insight && <p className={styles.insight}>{insight}</p>}

    {timeline.length > 0 && <div className={styles.timeline}>{timeline.map((item, index) => <div key={index} className={`${styles.row} ${styles[item.kind]} ${item.past ? styles.past : ""} ${item.startingIn ? styles.soon : ""}`}>
      <span className={styles.time}>{item.time}</span>
      <span className={styles.info}>
        <span className={styles.label}>{item.kind === "allday" && "All day · "}{item.label}</span>
        {item.duration && <small>{item.duration}{item.location ? ` · ${item.location}` : ""}</small>}
      </span>
      {item.startingIn && <span className={styles.tag}>{item.startingIn}</span>}
    </div>)}</div>}
  </section>;
}
