import type { DigestCardPayload } from "@/lib/chat/card-payload";
import styles from "./AnswerCard.module.css";

/** A news digest: the news line, then titled sections -- result/live event blocks, a hairline list of abandoned matches, date tiles for
 * what's coming up -- then sources, with follow-up chips outside the card. Built on the shared AnswerCard family. */
export function DigestCard({ payload, onFollowUp, busy }: { payload: DigestCardPayload; onFollowUp?: (text: string) => void; busy?: boolean }) {
  const { kindLabel, freshness, summary, sections, sources, chips } = payload;

  return <>
    <section className={styles.card} aria-label={kindLabel}>
      <div className={styles.header}>
        <span className={styles.kind}>{kindLabel}</span>
        {freshness && <span className={styles.freshness}>{freshness}</span>}
      </div>
      {summary && <p className={styles.summary}>{summary}</p>}

      {sections.map((section) => <div key={section.title} className={styles.section}>
        <span className={styles.sectionTitle}>{section.title}</span>

        {section.kind === "events" && section.events.map((event) => <div key={`${event.label}-${event.sides[0].name}`} className={`${styles.event} ${event.tag.tone === "live" ? "" : styles.eventFinal}`}>
          <div className={styles.eventHead}>
            <span className={styles.meta}>{event.label}</span>
            <span className={`${styles.tag} ${styles[event.tag.tone]}`}>
              {event.tag.tone === "live" && <span className={styles.liveDot} aria-hidden="true" />}
              {event.tag.label}
            </span>
          </div>
          {event.sides.map((side) => <div key={side.name} className={`${styles.side} ${side.lead ? styles.sideWinner : ""}`}>
            <span className={styles.sideName}>{side.name}{side.detail && <span className={styles.sideDetail}>{side.detail}</span>}</span>
            <span className={styles.sideScore}>{side.score}</span>
          </div>)}
        </div>)}

        {section.kind === "list" && <div className={styles.list}>{section.rows.map((row) => <div key={row.name} className={styles.row}>
          <div className={styles.rowMain}>
            <span className={styles.name}>{row.name}</span>
            <span className={styles.meta}>{row.meta}</span>
          </div>
          <div className={styles.rowEnd}><span className={`${styles.tag} ${styles[row.tag.tone]}`}>{row.tag.label}</span></div>
        </div>)}</div>}

        {section.kind === "tiles" && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))", gap: "var(--s-3)" }}>{section.tiles.map((tile) => <div key={tile.name} className={styles.event} style={{ flexDirection: "row", alignItems: "center", gap: "var(--s-4)" }}>
          <div className={`${styles.dateTile} ${tile.next ? styles.dateTileNext : ""}`}>
            <span className={styles.dateMonth}>{tile.month}</span>
            <span className={styles.dateDay}>{tile.day}</span>
          </div>
          <div className={styles.rowMain}>
            <span className={styles.name}>{tile.name}</span>
            {tile.meta && <span className={styles.meta}>{tile.meta}</span>}
          </div>
        </div>)}</div>}
      </div>)}

      {sources.length > 0 && <div className={styles.sources}>Sources {sources.map((source, index) => <span key={source.url}>
        {index > 0 && " · "}<a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a>
      </span>)}</div>}
    </section>
    {onFollowUp && chips.length > 0 && <div className={styles.chips}>{chips.map((chip) => <button key={chip.label} type="button" className={`${styles.chip} ${chip.act ? styles.chipAct : ""}`} disabled={busy} onClick={() => onFollowUp(chip.text)}>{chip.label}</button>)}</div>}
  </>;
}
