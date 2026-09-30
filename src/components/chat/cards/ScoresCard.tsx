import type { ScoresCardPayload } from "@/lib/chat/card-payload";
import styles from "./AnswerCard.module.css";

/** A roundup of several matches (e.g. the cricket on today): the shared event blocks stacked in one card. Each block's first line is the
 * match and a status tag; a side with no score yet is a not-started match and shows just its name. Built on the AnswerCard family. */
export function ScoresCard({ payload }: { payload: ScoresCardPayload }) {
  const { kindLabel, freshness, events, sources } = payload;

  return <section className={styles.card} aria-label={kindLabel}>
    <div className={styles.header}>
      <span className={styles.kind}>{kindLabel}</span>
      {freshness && <span className={styles.freshness}>{freshness}</span>}
    </div>

    {events.map((event) => <div key={`${event.label}-${event.sides[0].name}`} className={`${styles.event} ${event.tag.tone === "neutral" ? styles.eventFinal : ""}`}>
      <div className={styles.eventHead}>
        <span className={styles.meta}>{event.label}</span>
        <span className={`${styles.tag} ${styles[event.tag.tone]}`}>
          {event.tag.tone === "live" && <span className={styles.liveDot} aria-hidden="true" />}
          {event.tag.label}
        </span>
      </div>
      {event.sides.map((side) => <div key={side.name} className={`${styles.side} ${side.lead ? styles.sideWinner : ""}`}>
        <span className={side.score ? styles.sideName : styles.name}>
          {side.name}
          {side.detail && <span className={styles.sideDetail}>{side.detail}</span>}
        </span>
        {side.score && <span className={styles.sideScore}>{side.score}</span>}
      </div>)}
      {event.outcome && <p className={styles.outcome}>{event.outcome}</p>}
    </div>)}

    {sources.length > 0 && <div className={styles.sources}>Sources {sources.map((source, index) => <span key={source.label}>
      {index > 0 && " · "}<a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a>
    </span>)}</div>}
  </section>;
}
