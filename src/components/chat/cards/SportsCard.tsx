import type { SportsCardPayload } from "@/lib/chat/card-payload";
import styles from "./SportsCard.module.css";

/** The sports card: a team's own headline score (or next game), a colored status chip, an insight sentence, and
 * up to 2 stats (season record, next game). Same shape as StockCard, minus the day-range bar -- a score has no
 * equivalent to a price's day low/high. */
export function SportsCard({ payload }: { payload: SportsCardPayload }) {
  const { eyebrow, headline, statusLabel, resultDirection, insight, stats, attribution } = payload;

  return <section className={styles.card} aria-label={`${eyebrow}, ${headline}, ${statusLabel}`}>
    <p className={styles.eyebrow}>{eyebrow}</p>
    <div className={styles.hero}>
      <p className={styles.big}>{headline}</p>
      {statusLabel && <span className={`${styles.status} ${styles[resultDirection]}`}>{statusLabel}</span>}
    </div>
    {insight && <p className={styles.insight}>{insight}</p>}

    {stats.length > 0 && <div className={styles.stats}>{stats.map((stat) => <div key={stat.label} className={styles.stat}>
      <span className={styles.statLabel}>{stat.label}</span>
      <span className={styles.statValue}>{stat.value}</span>
    </div>)}</div>}

    <p className={styles.foot}>{attribution}</p>
  </section>;
}
