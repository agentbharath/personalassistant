import type { StockCardPayload } from "@/lib/chat/card-payload";
import styles from "./StockCard.module.css";

/** The stock card: current price, a signed change chip, an insight sentence, a day-range bar with the current
 * price marked on it, and 3 stats (previous close, volume, exchange). */
export function StockCard({ payload }: { payload: StockCardPayload }) {
  const { eyebrow, headline, changeLabel, changeDirection, insight, rangeLow, rangeHigh, current, stats, attribution } = payload;
  const span = Math.max(0.01, rangeHigh - rangeLow);
  const dotPercent = Math.min(100, Math.max(0, ((current - rangeLow) / span) * 100));

  return <section className={styles.card} aria-label={`${eyebrow}, ${headline}, ${changeLabel}`}>
    <p className={styles.eyebrow}>{eyebrow}</p>
    <div className={styles.hero}>
      <p className={styles.big}>{headline}</p>
      <span className={`${styles.change} ${styles[changeDirection]}`}>{changeLabel}</span>
    </div>
    {insight && <p className={styles.insight}>{insight}</p>}

    <div className={styles.range} aria-label={`Day low ${rangeLow}, high ${rangeHigh}`}>
      <span className={styles.rangeLabel}>L {rangeLow}</span>
      <span className={styles.rangeTrack} aria-hidden="true"><span className={styles.rangeDot} style={{ left: `${dotPercent}%` }} /></span>
      <span className={styles.rangeLabel}>H {rangeHigh}</span>
    </div>

    {stats.length > 0 && <div className={styles.stats}>{stats.map((stat) => <div key={stat.label} className={styles.stat}>
      <span className={styles.statLabel}>{stat.label}</span>
      <span className={styles.statValue}>{stat.value}</span>
    </div>)}</div>}

    <p className={styles.foot}>{attribution}</p>
  </section>;
}
