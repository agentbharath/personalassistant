import type { ScoresCardPayload } from "@/lib/chat/card-payload";
import { CardChips, CardFooter, SportsEvent } from "./CardParts";
import styles from "./DaylarkCards.module.css";

export function ScoresCard({ payload, onFollowUp, busy }: { payload: ScoresCardPayload; onFollowUp?: (text: string) => void; busy?: boolean }) {
  const { kindLabel, freshness, events, sources, limit, chips } = payload;
  return <>
    <section className={styles.card} aria-label={kindLabel}>
      <div className={styles.header}><span className={styles.kind}>{kindLabel}</span>{freshness && <span className={styles.freshness}>{freshness}</span>}</div>
      {events.map((event, index) => <SportsEvent key={`${event.label}-${index}`} event={event} />)}
      <CardFooter limit={limit} sources={sources} />
    </section>
    <CardChips chips={chips} onFollowUp={onFollowUp} busy={busy} />
  </>;
}
