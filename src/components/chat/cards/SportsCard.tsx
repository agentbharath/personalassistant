import type { ScoreCardPayload, SportsCardPayload } from "@/lib/chat/card-payload";
import { CardFooter } from "./CardParts";
import { ScoreCard } from "./ScoreCard";
import styles from "./DaylarkCards.module.css";

/** Legacy single-game payloads use the same one-match scoreboard as cricket. */
export function SportsCard({ payload }: { payload: SportsCardPayload }) {
  const { kindLabel, freshness, summary, eventLabel, statusTag, event, upcoming, attribution } = payload;
  const sources = attribution ? [{ label: attribution, url: `https://${attribution}` }] : [];
  if (event) return <ScoreCard payload={{
    kind: "score", match: eventLabel || kindLabel,
    status: { label: statusTag.label, tone: statusTag.tone === "live" ? "live" : statusTag.tone === "catch" ? "disrupted" : "final" },
    teams: event.sides.map(side => ({ name: side.name, score: side.score, detail: side.detail, lead: side.winner })) as ScoreCardPayload["teams"],
    outcome: event.outcome ? { kind: event.final ? "result" : "chase", text: event.outcome, detail: "", rates: [] } : null,
    tables: [], facts: summary ? [{ label: "Team", value: summary }] : [], sources, chips: [],
  }} />;
  return <section className={styles.card} aria-label={kindLabel}>
    <div className={styles.header}><span className={styles.kind}>{kindLabel}</span>{freshness && <span className={styles.freshness}>{freshness}</span>}</div>
    {summary && <p className={styles.summary}>{summary}</p>}
    {upcoming && <div className={styles.event}>
      <div className={styles.eventHead}>
        <div className={`${styles.dateTile} ${styles.dateTileNext}`}><span className={styles.dateMonth}>{upcoming.month}</span><span className={styles.dateDay}>{upcoming.day}</span></div>
        <div className={styles.rowMain} style={{ flex: 1 }}><span className={styles.name}>{upcoming.matchup}</span><span className={styles.meta}>{upcoming.detail}</span></div>
      </div>
    </div>}
    <CardFooter sources={sources} />
  </section>;
}
