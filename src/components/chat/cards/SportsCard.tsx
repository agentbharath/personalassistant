import type { SportsCardPayload } from "@/lib/chat/card-payload";
import styles from "./AnswerCard.module.css";

/** The sports card: one head-to-head event (score, winner bold, a green outcome line) for a decided or live game, or a simple
 * upcoming-game tile when nothing has been played yet. Built on the shared AnswerCard family, not a bespoke layout. */
export function SportsCard({ payload }: { payload: SportsCardPayload }) {
  const { kindLabel, freshness, summary, eventLabel, statusTag, event, upcoming, attribution } = payload;

  return <section className={styles.card} aria-label={`${kindLabel}, ${eventLabel}`}>
    <div className={styles.header}>
      <span className={styles.kind}>{kindLabel}</span>
      {freshness && <span className={styles.freshness}>{freshness}</span>}
    </div>
    {summary && <p className={styles.summary}>{summary}</p>}

    {event && <div className={`${styles.event} ${event.final ? styles.eventFinal : ""}`}>
      <div className={styles.eventHead}>
        <span className={styles.meta}>{eventLabel}</span>
        <span className={`${styles.tag} ${styles[statusTag.tone]}`}>
          {statusTag.tone === "live" && <span className={styles.liveDot} aria-hidden="true" />}
          {statusTag.label}
        </span>
      </div>
      {event.sides.map((side) => <div key={side.name} className={`${styles.side} ${side.winner ? styles.sideWinner : ""}`}>
        <span className={styles.sideName}>{side.name}</span>
        <span>
          <span className={styles.sideScore}>{side.score}</span>
          {side.detail && <span className={styles.sideDetail}>{side.detail}</span>}
        </span>
      </div>)}
      {event.outcome && <p className={styles.outcome}>{event.outcome}</p>}
    </div>}

    {upcoming && <div className={styles.event}>
      <div className={styles.eventHead} style={{ gap: "var(--s-4)" }}>
        <div className={styles.dateTile}>
          <span className={styles.dateMonth}>{upcoming.month}</span>
          <span className={styles.dateDay}>{upcoming.day}</span>
        </div>
        <div className={styles.rowMain} style={{ flex: 1 }}>
          <span className={styles.name}>{upcoming.matchup}</span>
          <span className={styles.meta}>{upcoming.detail}</span>
        </div>
      </div>
    </div>}

    {attribution && <p className={styles.limit}>{attribution}</p>}
  </section>;
}
