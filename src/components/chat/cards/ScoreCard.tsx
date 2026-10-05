import type { CSSProperties } from "react";
import type { ScoreCardPayload } from "@/lib/chat/card-payload";
import { CardChips, CardFooter, CardTag } from "./CardParts";
import styles from "./DaylarkCards.module.css";

const statusTone = { final: "neutral", live: "live", upcoming: "highlight", disrupted: "catch" } as const;
const ballStyle = { dot: "ballDot", run: "", boundary: "ballBoundary", wicket: "ballWicket", pending: "ballPending" } as const;

export function ScoreCard({ payload, onFollowUp, busy }: { payload: ScoreCardPayload; onFollowUp?: (text: string) => void; busy?: boolean }) {
  const { match, status, teams, outcome, tables, facts, sources, chips, thisOver } = payload;
  return <>
    <section className={styles.card} aria-label={`${teams[0].name} vs ${teams[1].name}, ${match}`}>
      <div className={styles.header}><span className={styles.kind}>{match}</span><CardTag label={status.label} tone={statusTone[status.tone]} /></div>
      <div className={styles.scoreboard}>
        {teams.map(team => <div key={team.name} className={`${styles.team} ${team.lead ? styles.lead : ""}`}>
          <span className={styles.teamName}>{team.name}{team.detail && <span className={`${styles.teamDetail} ${styles.teamDetailMobile}`}>{team.detail}</span>}</span>
          <span className={styles.teamScore}>{team.score}{team.detail && <span className={`${styles.teamDetail} ${styles.teamDetailDesktop}`}>{team.detail}</span>}</span>
        </div>)}
        {outcome && <div className={styles.outcome}>
          <span className={outcome.kind === "result" && status.tone !== "disrupted" ? styles.result : styles.chase}>{outcome.text}</span>
          {outcome.detail && <span className={styles.outcomeDetail}>{outcome.detail}</span>}
          {outcome.rates.length > 0 && <span className={styles.rates}>{outcome.rates.map(rate => <span key={rate}>{rate}</span>)}</span>}
        </div>}
      </div>
      {status.tone === "live" && Boolean(thisOver?.length) && <div className={styles.over} role="group" aria-label="This over">
        <span className={styles.overLabel}>This over</span>
        {thisOver!.map((ball, index) => <span key={index} className={`${styles.ball} ${ballStyle[ball.kind] ? styles[ballStyle[ball.kind]] : ""}`} role="img" aria-label={`Ball ${index + 1}: ${ball.kind === "pending" ? "not bowled" : ball.label}`}>{ball.label}</span>)}
      </div>}
      {tables.map(table => <div key={table.title} className={styles.section}>
        <span className={styles.sectionTitle}>{table.title}</span>
        <div className={styles.table} role="table" aria-label={table.title} style={{ "--stat-cols": table.columns.length } as CSSProperties}>
          <div className={`${styles.statRow} ${styles.statHead}`} role="row"><span role="columnheader" aria-label="Player" />{table.columns.map(column => <span key={column} role="columnheader">{column}</span>)}</div>
          {table.rows.map(row => <div key={`${row.player}-${row.side}`} className={styles.statRow} role="row">
            <span className={styles.player} role="rowheader"><span className={row.onStrike ? styles.onStrike : undefined}>{row.player}</span><span className={styles.playerSide}>{row.side}</span></span>
            {row.stats.map((stat, index) => <span key={index} className={styles.stat} role="cell">{stat}</span>)}
          </div>)}
        </div>
      </div>)}
      {facts.length > 0 && <div className={styles.facts}>{facts.map(fact => <div key={fact.label} className={styles.fact}><span className={styles.factLabel}>{fact.label}</span><span className={styles.factValue}>{fact.value}</span></div>)}</div>}
      <CardFooter limit={payload.limit} sources={sources} />
    </section>
    <CardChips chips={chips} onFollowUp={onFollowUp} busy={busy} />
  </>;
}
