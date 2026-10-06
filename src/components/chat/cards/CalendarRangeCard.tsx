import type { CalendarRangeCardPayload } from "@/lib/chat/card-payload";
import styles from "./CalendarRangeCard.module.css";

/** A multi-day calendar range ("this week", "next week"), grouped by day -- the same attendee/location/video-call
 * detail the single-day timeline card shows, so a meeting reads as more than just a title and a time. */
export function CalendarRangeCard({ payload }: { payload: CalendarRangeCardPayload }) {
  const { rangeLabel, count, insight, days } = payload;
  return <section className={styles.card} aria-label={`Calendar, ${rangeLabel}`}>
    <p className={styles.eyebrow}>{rangeLabel[0]?.toUpperCase()}{rangeLabel.slice(1)}</p>
    <p className={styles.big}>{count} event{count === 1 ? "" : "s"}</p>
    {insight && <p className={styles.insight}>{insight}</p>}
    <div className={styles.days}>{days.map((day) => <div key={day.dateLabel} className={styles.day}>
      <p className={styles.dayLabel}>{day.dateLabel}</p>
      {day.events.map((event, index) => <div key={index} className={styles.row}>
        <span className={styles.time}>{event.allDay ? "All day" : event.time}</span>
        <div className={styles.info}>
          <span className={styles.label} title={event.label}>{event.label}</span>
          {(event.duration || event.location || event.videoCall || event.people) && <small>
            {event.duration}
            {event.location ? `${event.duration ? " · " : ""}${event.location}` : event.videoCall ? `${event.duration ? " · " : ""}Video call` : ""}
            {event.people ? `${event.duration || event.location || event.videoCall ? " · " : ""}${event.people}` : ""}
          </small>}
        </div>
      </div>)}
    </div>)}</div>
    <p className={styles.foot}>Google Calendar</p>
  </section>;
}
