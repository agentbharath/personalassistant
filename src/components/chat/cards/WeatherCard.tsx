import type { WeatherCardPayload } from "@/lib/chat/card-payload";
import styles from "./WeatherCard.module.css";

/** The weather card: hero reading (a temperature, or a plain Yes/No for a rain/snow question), an insight
 * sentence, a min-max range with today's reading marked on it, an hourly strip, and up to 3 relevant stats. */
export function WeatherCard({ payload }: { payload: WeatherCardPayload }) {
  const { eyebrow, headline, condition, insight, rangeLow, rangeHigh, current, hourly, hourlyUnit, stats, attribution } = payload;
  const span = Math.max(1, rangeHigh - rangeLow);
  const dotPercent = Math.min(100, Math.max(0, ((current - rangeLow) / span) * 100));
  const maxHourly = Math.max(1, ...hourly.map((point) => point.value));

  return <section className={styles.card} aria-label={`${eyebrow}, ${headline} ${condition}`}>
    <p className={styles.eyebrow}>{eyebrow}</p>
    <div className={styles.hero}>
      <p className={styles.big}>{headline}</p>
      <p className={styles.condition}>{condition}</p>
    </div>
    {insight && <p className={styles.insight}>{insight}</p>}

    <div className={styles.range}>
      <span className={styles.rangeLabel}>{rangeLow}°</span>
      <span className={styles.rangeTrack} aria-hidden="true"><span className={styles.rangeDot} style={{ left: `${dotPercent}%` }} /></span>
      <span className={styles.rangeLabel}>{rangeHigh}°</span>
    </div>

    <div className={styles.hourly}>{hourly.map((point, index) => <div key={index} className={`${styles.hourCol} ${point.highlighted ? styles.hourNow : ""}`}>
      <span className={styles.hourValue}>{point.value}{hourlyUnit === "precip" ? "%" : "°"}</span>
      <span className={styles.hourBarTrack}><span className={styles.hourBar} style={{ height: `${Math.max((point.value / maxHourly) * 100, 6)}%` }} /></span>
      <span className={styles.hourLabel}>{point.label}</span>
    </div>)}</div>

    {stats.length > 0 && <div className={styles.stats}>{stats.map((stat) => <div key={stat.label} className={styles.stat}>
      <span className={styles.statLabel}>{stat.label}</span>
      <span className={styles.statValue}>{stat.value}</span>
    </div>)}</div>}

    <p className={styles.foot}>{attribution}</p>
  </section>;
}
