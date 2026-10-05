import type { CardChip, ScoresEvent } from "@/lib/chat/card-payload";
import styles from "./DaylarkCards.module.css";

export function CardTag({ label, tone }: { label: string; tone: "good" | "highlight" | "neutral" | "catch" | "live" | "pick" }) {
  return <span className={`${styles.tag} ${styles[tone]}`}>{tone === "live" && <span className={styles.liveDot} aria-hidden="true" />}{label}</span>;
}

export function CardFooter({ limit, sources }: { limit?: string; sources: { label: string; url: string }[] }) {
  return <>
    {limit && <p className={styles.limit}>{limit}</p>}
    {sources.length > 0 && <div className={styles.sources}><span>Sources</span>{sources.map(source => {
      let domain: string;
      try { domain = new URL(source.url).hostname.replace(/^www\./, ""); } catch { return null; }
      return <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{domain}</a>;
    })}</div>}
  </>;
}

export function CardChips({ chips = [], onFollowUp, busy }: { chips?: CardChip[]; onFollowUp?: (text: string) => void; busy?: boolean }) {
  const purposes = new Set<string>();
  const available = chips.map(chip => typeof chip === "string" ? { label: chip, text: chip } : chip)
    .filter(chip => {
      if (!chip.purpose) return true;
      if (purposes.has(chip.purpose)) return false;
      purposes.add(chip.purpose);
      return true;
    }).filter(chip => chip.label && (chip.url || (chip.text && onFollowUp))).slice(0, 4);
  if (!available.length) return null;
  let actionShown = false;
  return <div className={styles.chips} role="group" aria-label="Follow-up options">{available.map((chip, index) => {
    const act = !actionShown && (chip.act || chip.purpose === "act");
    if (act) actionShown = true;
    const className = `${styles.chip} ${act ? styles.chipAct : ""}`;
    if (chip.url) return <a key={`${chip.label}-${index}`} className={className} href={chip.url} target="_blank" rel="noopener noreferrer">{chip.label}</a>;
    return <button key={`${chip.label}-${index}`} type="button" className={className} disabled={busy} onClick={() => onFollowUp?.(chip.text!)}>{chip.label}</button>;
  })}</div>;
}

/** A shared competitor grid: rank, name/detail, then any number of sport-specific score cells. */
export function SportsEvent({ event }: { event: ScoresEvent }) {
  const finished = event.final ?? (event.tag.tone === "neutral" || event.tag.tone === "good");
  return <div className={`${styles.event} ${finished ? styles.eventDone : ""}`}>
    <div className={styles.eventHead}><span className={styles.eventMeta}>{event.label}</span><CardTag {...event.tag} /></div>
    {event.sides.map((side, index) => <div key={`${side.name}-${index}`} className={`${styles.competitor} ${side.lead ? styles.leader : ""}`}>
      <span className={styles.rank}>{side.rank}</span>
      <span className={styles.competitorName}>{side.name}{side.detail && <span className={styles.competitorDetail}>{side.detail}</span>}</span>
      <span className={styles.cells}>{(side.cells ?? (side.score ? [side.score] : [])).map((cell, index) => <span key={index} className={styles.cell}>{cell}</span>)}</span>
    </div>)}
    {event.outcome && <p className={event.tag.tone === "catch" ? styles.eventMeta : styles.eventResult}>{event.outcome}</p>}
  </div>;
}
