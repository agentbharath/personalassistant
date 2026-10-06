import { Fragment } from "react";
import type { DayCardPayload } from "@/lib/chat/card-payload";
import styles from "./DayCard.module.css";

export function DayCard({ payload }: { payload: DayCardPayload }) {
  const { dateLabel, count, insight, timeline, nowMarker } = payload;
  const marker = <div className={styles.now}><span>{nowMarker?.label}</span><i /><small>At reply</small></div>;
  return <section className={styles.card} aria-label={`Calendar, ${dateLabel}`}>
    <p className={styles.eyebrow}>{dateLabel}</p>
    <p className={styles.big}>{count} event{count === 1 ? "" : "s"}</p>
    {insight && <p className={styles.insight}>{insight}</p>}
    <div className={styles.timeline}>{timeline.map((item, index) => <Fragment key={index}>
      {nowMarker?.index === index && marker}
      <div className={`${styles.row} ${styles[item.kind]} ${item.past ? styles.past : ""}`}>
        <span className={styles.time}>{item.time}</span>
        <div className={`${styles.info} ${item.kind === "meeting" && !item.past ? styles.upcoming : ""} ${item.startingIn ? styles.soon : ""}`}>
          <span className={styles.label} title={item.label}>{item.kind === "allday" && "All day · "}{item.label}</span>
          {(item.duration || item.people) && <small title={[item.location, item.people].filter(Boolean).join(" · ") || undefined}>
            {item.duration}
            {item.location && (item.past || item.kind !== "meeting") ? ` · ${item.location}` : item.videoCall ? " · Video call" : ""}
            {item.people ? `${item.duration ? " · " : ""}${item.people}` : ""}
          </small>}
          {item.startingIn && <span className={styles.tag}>{item.startingIn}</span>}
        </div>
      </div>
    </Fragment>)}{nowMarker?.index === timeline.length && marker}</div>
    <p className={styles.foot}>Google Calendar{payload.asOf ? ` · snapshot at ${payload.asOf}` : " · at time of reply"}</p>
  </section>;
}
