import { CardChips, CardFooter, SportsEvent } from "./CardParts";
import type { DigestCardPayload } from "@/lib/chat/card-payload";
import styles from "./DaylarkCards.module.css";

/** A news digest: the news line, then titled sections -- result/live event blocks, a hairline list of abandoned matches, date tiles for
 * what's coming up -- then sources, with follow-up chips outside the card. Built on the shared DaylarkCards family. */
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

        {section.kind === "events" && section.events.map((event, index) => <SportsEvent key={`${event.label}-${index}`} event={event} />)}

        {section.kind === "list" && <div className={styles.list}>{section.rows.map((row) => <div key={row.name} className={styles.row}>
          <div className={styles.rowMain}>
            <span className={styles.name}>{row.name}</span>
            <span className={styles.meta}>{row.meta}</span>
          </div>
          <div className={styles.rowEnd}><span className={`${styles.tag} ${styles[row.tag.tone]}`}>{row.tag.label}</span></div>
        </div>)}</div>}

        {section.kind === "stories" && <div className={styles.list}>{section.stories.map((story) => <a key={story.url} className={styles.row} href={story.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
          <div className={styles.rowMain}>
            <span className={styles.name}>{story.headline}</span>
            {story.meta && <span className={styles.meta}>{story.meta}</span>}
          </div>
        </a>)}</div>}

        {section.kind === "tiles" && <div className={styles.tiles}>{section.tiles.map((tile) => <div key={tile.name} className={styles.event} style={{ flexDirection: "row", alignItems: "center", gap: "var(--s-4)" }}>
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

      <CardFooter limit={payload.limit} sources={sources} />
    </section>
    <CardChips chips={chips} onFollowUp={onFollowUp} busy={busy} />
  </>;
}
