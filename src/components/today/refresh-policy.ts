/** Refresh only when the tab was away for a while, so flipping between tabs does not reload the page each time. */
export const MIN_AWAY_MS = 60_000;

export function shouldRefreshOnReturn(hiddenAt: number | null, now: number, minAwayMs = MIN_AWAY_MS) {
  return hiddenAt !== null && now - hiddenAt >= minAwayMs;
}
