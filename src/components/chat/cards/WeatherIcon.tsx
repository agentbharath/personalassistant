import type { WeatherCardPayload } from "@/lib/chat/card-payload";
import styles from "./WeatherCard.module.css";
export function WeatherIcon({ kind }: { kind: NonNullable<WeatherCardPayload["appearance"]> }) {
  return <span className={`${styles.icon} ${styles[kind]}`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {kind === "sun" ? <g className={styles.sunRays}><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></g>
    : kind === "night" ? <><path d="M19.8 15.2A8 8 0 0 1 8.8 4.2 8 8 0 1 0 19.8 15.2Z"/><path d="M18 3v4m-2-2h4"/></>
    : kind === "fog" ? <g className={styles.fogBands}><path d="M4 7h14M2 12h20M6 17h14"/></g>
    : <><path d="M6 16a4 4 0 0 1-.5-8 6 6 0 0 1 11.2-1A4.5 4.5 0 1 1 18 16Z"/>{kind === "rain" && <g className={styles.drops}><path d="m8 19-1 2m6-2-1 2m6-2-1 2"/></g>}{kind === "snow" && <path d="M8 20h.01M12 21h.01M17 20h.01"/>}</>}
  </svg></span>;
}
