import type { ScoreCardPayload } from "@/lib/chat/card-payload";
import styles from "./ScoreCard.module.css";

/** The one-match score card: header with a status tag, the sunken scoreboard (winner or batting side in ink), the result or live chase
 * under it, stat tables, match facts, sources, then follow-up chips outside the card. Cricket is the reference layout. */
export function ScoreCard({ payload, onFollowUp, busy }: { payload: ScoreCardPayload; onFollowUp?: (text: string) => void; busy?: boolean }) {
  const { match, status, teams, outcome, tables, facts, sources, chips } = payload;

  return <>
    <section className={styles.card} aria-label={`${teams[0].name} vs ${teams[1].name}, ${match}`}>
      <div className={styles.header}>
        <span className={styles.match}>{match}</span>
        <span className={`${styles.tag} ${styles[status.tone]}`}>
          {status.tone === "live" && <span className={styles.liveDot} aria-hidden="true" />}
          {status.label}
        </span>
      </div>

      <div className={styles.scoreboard}>
        {teams.map((team) => <div key={team.name} className={`${styles.team} ${team.lead ? styles.lead : ""}`}>
          <span className={styles.teamName}>{team.name}</span>
          <span className={styles.teamScore}>
            {team.score}
            {team.detail && <span className={styles.teamDetail}>{team.detail}</span>}
          </span>
        </div>)}
        {outcome && <div className={styles.outcome}>
          <span className={outcome.kind === "result" ? styles.result : styles.chase}>{outcome.text}</span>
          {outcome.detail && <span className={styles.outcomeDetail}>{outcome.detail}</span>}
          {outcome.rates.length > 0 && <span className={styles.rates}>{outcome.rates.map((rate) => <span key={rate}>{rate}</span>)}</span>}
        </div>}
      </div>

      {tables.map((table) => <div key={table.title} className={styles.section}>
        <span className={styles.sectionTitle}>{table.title}</span>
        <div className={styles.table} style={{ "--stat-cols": table.columns.length } as React.CSSProperties}>
          <div className={`${styles.statRow} ${styles.statHead}`}>
            <span />
            {table.columns.map((column) => <span key={column}>{column}</span>)}
          </div>
          {table.rows.map((row) => <div key={`${row.player}-${row.side}`} className={styles.statRow}>
            <span className={styles.player}>{row.player}<span className={styles.playerSide}>{row.side}</span></span>
            {row.stats.map((stat, index) => <span key={index} className={styles.stat}>{stat}</span>)}
          </div>)}
        </div>
      </div>)}

      {facts.length > 0 && <div className={styles.facts}>{facts.map((fact) => <div key={fact.label} className={styles.fact}>
        <span className={styles.factLabel}>{fact.label}</span>
        <span className={styles.factValue}>{fact.value}</span>
      </div>)}</div>}

      {sources.length > 0 && <div className={styles.sources}>Sources {sources.map((source, index) => <span key={source.label}>
        {index > 0 && " · "}<a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a>
      </span>)}</div>}
    </section>

    {chips.length > 0 && <div className={styles.chips}>{chips.map((chip) => {
      const className = `${styles.chip} ${chip.act ? styles.chipAct : ""}`;
      if (chip.url) return <a key={chip.label} className={className} href={chip.url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>{chip.label}</a>;
      return onFollowUp && chip.text ? <button key={chip.label} type="button" className={className} disabled={busy} onClick={() => onFollowUp(chip.text!)}>{chip.label}</button> : null;
    })}</div>}
  </>;
}
