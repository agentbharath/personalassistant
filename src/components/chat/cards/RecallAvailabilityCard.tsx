"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { CheckIcon } from "@/components/ui/icons";
import type { RecallAvailabilityCardPayload } from "@/lib/chat/card-payload";
import styles from "./RecallAvailabilityCard.module.css";

/** The combined "recall a place + check the calendar" card (R33): a checkmark section for the calendar half, a
 * question-mark section for the recall half -- a radio picker when it's ambiguous, a plain resolved line when
 * conversation text already named one. Either half can be null (falls back to nothing shown for that half, not
 * a broken layout) since the caller only embeds this card when at least one half resolved. */
export function RecallAvailabilityCard({ payload, onFollowUp, busy }: { payload: RecallAvailabilityCardPayload; onFollowUp?: (text: string) => void; busy?: boolean }) {
  const { headline, availability, recall, planQuery, noneQuery } = payload;
  const [selected, setSelected] = useState<string | null>(null);
  const day = availability?.dateLabel.split(",")[0]?.trim() || "it";

  return <section className={styles.card} aria-label={headline}>
    <p className={styles.headline}>{headline}</p>

    {availability && <div className={styles.row}>
      <span className={`${styles.badge} ${styles.badgeOk}`}><CheckIcon width={16} height={16} /></span>
      <div className={styles.body}>
        <p className={styles.rowTitle}>{availability.dateLabel}</p>
        <p className={styles.rowNote}>{availability.note}</p>
        <div className={styles.bar} role="img" aria-label={availability.free ? "Free the whole time" : availability.note}>
          {availability.segments.map((segment, index) => <span key={index} className={segment.kind === "free" ? styles.free : styles.busy} style={{ width: `${segment.widthPercent}%` }} title={segment.label}>
            {segment.widthPercent > 20 ? segment.label : ""}
          </span>)}
        </div>
        <div className={styles.ticks}>{availability.ticks.map((tick, index) => <span key={index}>{tick}</span>)}</div>
      </div>
    </div>}

    {recall && <div className={styles.row}>
      <span className={`${styles.badge} ${styles.badgeAsk}`}>?</span>
      <div className={styles.body}>
        <p className={styles.rowTitle}>{recall.question}</p>
        <p className={styles.rowNote}>{recall.note}</p>
        {recall.resolvedName ? <Button size="sm" variant="primary" disabled={busy || !onFollowUp} onClick={() => onFollowUp?.(planQuery.replace("{name}", recall.resolvedName!))}>Plan it</Button> : <>
          <div className={styles.candidates} role="radiogroup" aria-label={recall.question}>
            {recall.candidates.map((candidate) => <label key={candidate.id} className={`${styles.candidate} ${selected === candidate.name ? styles.candidateSelected : ""}`}>
              <input type="radio" name="recall-candidate" value={candidate.id} checked={selected === candidate.name} onChange={() => setSelected(candidate.name)} />
              {candidate.name}
            </label>)}
          </div>
          {recall.moreCount > 0 && <p className={styles.more}>{recall.moreCount} older result{recall.moreCount === 1 ? "" : "s"}</p>}
          <div className={styles.actions}>
            <Button size="sm" variant="primary" disabled={busy || !onFollowUp || !selected} onClick={() => selected && onFollowUp?.(planQuery.replace("{name}", selected))}>Pick one to plan {day}</Button>
            <Button size="sm" variant="secondary" disabled={busy || !onFollowUp} onClick={() => onFollowUp?.(noneQuery)}>None of these</Button>
          </div>
        </>}
      </div>
    </div>}
  </section>;
}
