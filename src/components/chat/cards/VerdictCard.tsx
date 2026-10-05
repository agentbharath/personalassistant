import { CardChips, CardFooter } from "./CardParts";
import type { VerdictCardPayload } from "@/lib/chat/card-payload";
import styles from "./DaylarkCards.module.css";

/** A follow-up verdict: the conclusion first on the sunken "bottom line" block, then one hairline row per earlier option with its own
 * single verdict tag, sources, and follow-up chips outside the card. Built on the shared DaylarkCards family. */
export function VerdictCard({ payload, onFollowUp, busy }: { payload: VerdictCardPayload; onFollowUp?: (text: string) => void; busy?: boolean }) {
  const { kindLabel, basis, bottomLine, rows, sources, chips } = payload;

  return <>
    <section className={styles.card} aria-label={kindLabel}>
      <div className={styles.header}>
        <span className={styles.kind}>{kindLabel}</span>
        {basis && <span className={styles.freshness}>{basis}</span>}
      </div>

      <div className={styles.bottomLine}>
        <span className={styles.meta}>Bottom line</span>
        <span className={styles.bottomLineText}>{bottomLine}</span>
      </div>

      {rows.length > 0 && <div className={styles.list}>{rows.map((row) => <div key={row.name} className={styles.row}>
        <div className={styles.rowMain}>
          <span className={styles.name}>{row.name}{row.metric && <span className={styles.numMuted} style={{ fontSize: "var(--text-base)", marginLeft: "var(--s-2)" }}>{row.metric}</span>}</span>
          {row.detail && <span className={styles.meta}>{row.detail}</span>}
        </div>
        <div className={styles.rowEnd}><span className={`${styles.tag} ${styles[row.tag.tone]}`}>{row.tag.label}</span></div>
      </div>)}</div>}

      <CardFooter limit={payload.limit} sources={sources} />
    </section>
    <CardChips chips={chips} onFollowUp={onFollowUp} busy={busy} />
  </>;
}
