import type { WeatherCardPayload } from "@/lib/chat/card-payload";
import { WeatherIcon } from "./WeatherIcon";
import styles from "./WeatherCard.module.css";

/** The weather card: hero reading (a temperature, or a plain Yes/No for a rain/snow question), an insight
 * sentence, a min-max range with today's reading marked on it, an hourly strip, and up to 3 relevant stats. */
export function WeatherCard({ payload }: { payload: WeatherCardPayload }) {
  const { eyebrow, headline, condition, insight, rangeLow, rangeHigh, current, hourly, hourlyUnit, stats, attribution } = payload;
  const span = Math.max(1, rangeHigh - rangeLow);
  const dotPercent = Math.min(100, Math.max(0, ((current - rangeLow) / span) * 100));
  const low = Math.min(...hourly.map(point => point.value)) - 5;
  const high = Math.max(...hourly.map(point => point.value)) + 2;
  const appearance = payload.appearance ?? (/fog/i.test(condition) ? "fog" : /snow/i.test(condition) ? "snow" : /rain|shower/i.test(condition) ? "rain" : /tonight/i.test(eyebrow) ? "night" : /cloud|overcast/i.test(condition) ? "cloud" : "sun");

  return <section className={`${styles.card} ${hourlyUnit === "precip" ? styles.precip : ""}`} aria-label={`${eyebrow}, ${headline} ${condition}`}>
    <div className={styles.heading}><p className={styles.eyebrow}>{eyebrow}</p><WeatherIcon kind={appearance}/></div>
    <div className={styles.hero}>
      <p className={`${styles.big} ${headline.endsWith("°") ? "" : styles.words}`}>{headline}</p>
      <p className={styles.condition}>{condition}</p>
    </div>
    {insight && <p className={styles.insight}>{insight}</p>}

    <div className={styles.range} aria-label={`Low ${rangeLow}, high ${rangeHigh} degrees Fahrenheit`}>
      <span className={styles.rangeLabel}>L {rangeLow}°</span>
      <span className={styles.rangeTrack} aria-hidden="true"><span className={styles.rangeDot} style={{ left: `${dotPercent}%` }} /></span>
      <span className={styles.rangeLabel}>H {rangeHigh}°</span>
    </div>

    <div><p className={styles.hourlyTitle}>{payload.hourlyLabel ?? (hourlyUnit === "precip" ? "Hourly precipitation chance" : "Hourly forecast · °F")}</p><div className={styles.hourly}>{hourly.map((point, index) => <div key={index} className={`${styles.hourCol} ${point.highlighted ? styles.hourNow : ""}`}>
      <span className={styles.hourValue}>{point.value}{hourlyUnit === "precip" ? "%" : "°"}</span>
      <span className={styles.hourBarTrack}><span className={styles.hourBar} style={{ height: `${hourlyUnit === "precip" ? Math.max(0, Math.min(100, point.value)) : ((point.value - low) / (high - low)) * 100}%` }} /></span>
      <span className={styles.hourLabel}>{point.label}</span>
    </div>)}</div></div>

    {stats.length > 0 && <div className={styles.stats}>{stats.map((stat) => <div key={stat.label} className={styles.stat}>
      <span className={styles.statLabel}>{stat.label}</span>
      <span className={styles.statValue}>{stat.value}</span>
    </div>)}</div>}

    <p className={styles.foot}>{attribution}</p>
  </section>;
}
