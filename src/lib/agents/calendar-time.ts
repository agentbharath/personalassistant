import { Temporal } from "@js-temporal/polyfill";

export const DEFAULT_EVENT_MINUTES = 120;

export function normalizeTimeFromEvidence<T extends { start: string | null; end: string | null; timeZone: string | null }>(candidate: T, evidence: string, defaultMinutes = DEFAULT_EVENT_MINUTES): T {
  const { start, end, timeZone } = candidate;
  if (!start || !timeZone) return candidate;
  const sourceTime = evidence.match(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i);
  if (!sourceTime) return candidate;
  const expectedHour = (Number(sourceTime[1]) % 12) + (sourceTime[3].toUpperCase() === "PM" ? 12 : 0);
  const expectedMinute = Number(sourceTime[2] ?? 0);
  const localStart = Temporal.Instant.from(start).toZonedDateTimeISO(timeZone);
  if (localStart.hour === expectedHour && localStart.minute === expectedMinute) return candidate;
  const correctedStart = localStart.with({ hour: expectedHour, minute: expectedMinute, second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 });
  const durationMs = end ? new Date(end).getTime() - new Date(start).getTime() : defaultMinutes * 60_000;
  const correctedEnd = correctedStart.toInstant().add({ milliseconds: Math.max(durationMs, 60_000) });
  return { ...candidate, start: correctedStart.toInstant().toString(), end: correctedEnd.toString() };
}
