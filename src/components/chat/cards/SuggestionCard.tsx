import type { SuggestionCardPayload } from "@/lib/chat/card-payload";
import styles from "./AnswerCard.module.css";

/** The suggestions card: a top-pick hero (name, metric, an edge tag, one reason, an action link) and 1-3 compact rows below it,
 * each with its own single verdict tag. Built on the shared AnswerCard family, same as the sports card. */
export function SuggestionCard({ payload, onFollowUp, busy }: { payload: SuggestionCardPayload; onFollowUp?: (text: string) => void; busy?: boolean }) {
  const { kindLabel, freshness, topPick, rows, limit, sources, chips } = payload;

  return <>
    <section className={styles.card} aria-label={`${kindLabel}, top pick ${topPick.name}`}>
      <div className={styles.header}>
        <span className={styles.kind}>{kindLabel}</span>
        {freshness && <span className={styles.freshness}>{freshness}</span>}
      </div>

      <div className={styles.hero}>
        <div className={styles.heroTop}>
          <div>
            <span className={`${styles.tag} ${styles.pick}`}>Top pick</span>
            <p className={styles.heroName}>{topPick.name}</p>
            <p className={styles.meta}>{topPick.meta}</p>
          </div>
          <div className={styles.heroEnd}>
            <span className={styles.heroMetric}>{topPick.metric}</span>
            {topPick.edgeTag && <span className={`${styles.tag} ${styles[topPick.edgeTag.tone]}`}>{topPick.edgeTag.label}</span>}
          </div>
        </div>
        {topPick.reason && <p className={styles.reason}>{topPick.reason}</p>}
        {topPick.actionUrl && <a className={styles.action} href={topPick.actionUrl} target="_blank" rel="noopener noreferrer">{topPick.actionLabel}</a>}
      </div>

      {rows.length > 0 && <div className={styles.list}>{rows.map((row) => <div key={row.name} className={styles.row}>
        <div className={styles.rowMain}>
          <span className={styles.name}>{row.name}</span>
          <span className={styles.meta}>{row.meta}</span>
        </div>
        <div className={styles.rowEnd}>
          <span className={`${styles.tag} ${styles[row.roleTag.tone]}`}>{row.roleTag.label}</span>
          <span className={styles.num}>{row.metric}</span>
        </div>
      </div>)}</div>}

      {limit && <p className={styles.limit}>{limit}</p>}
      {sources.length > 0 && <div className={styles.sources}>Sources {sources.map((source, index) => <span key={source.url}>
        {index > 0 && " · "}<a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a>
      </span>)}</div>}
    </section>
    {onFollowUp && chips.length > 0 && <div className={styles.chips}>{chips.map((chip) => <button key={chip} type="button" className={styles.chip} disabled={busy} onClick={() => onFollowUp(chip)}>{chip}</button>)}</div>}
  </>;
}
