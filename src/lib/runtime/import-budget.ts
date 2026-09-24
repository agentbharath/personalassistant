/** Bulk mailbox work gets more time; leave 30 seconds under the chat route's 300-second ceiling for persistence. */
export const IMPORT_BUDGET = {
  totalMs: 270_000,
  searchMs: 120_000,
  readMs: 240_000,
  finishReserveMs: 30_000,
  costLimitUsd: 0.40,
} as const;
