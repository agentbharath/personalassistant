import * as Sentry from "@sentry/nextjs";

type Field = string | number | boolean | null | undefined;
export type LogFields = Record<string, Field>;

/** One shape for every structured log line: `event {"field":value}`. Values are plain and small, and never message text or mail content. */
export function logEvent(level: "info" | "warn" | "error", event: string, fields: LogFields = {}) {
  console[level](event, JSON.stringify(fields));
}

/** What is safe to say about an error: its type and any status or code it carries. Its message can hold private data (a subject, an address), so it is never used. */
export function describeError(error: unknown): { errorName: string; status?: number; code?: string; reason?: string } {
  if (!error || typeof error !== "object") return { errorName: typeof error };
  const value = error as { name?: unknown; status?: unknown; code?: unknown; reason?: unknown };
  return {
    errorName: typeof value.name === "string" ? value.name : "Error",
    ...(typeof value.status === "number" ? { status: value.status } : {}),
    ...(typeof value.code === "string" ? { code: value.code } : {}),
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
  };
}

const THROTTLE_MS = 60_000;
const lastSent = new Map<string, number>();

/** Tag keys that may travel to Sentry: short labels, not content. */
const TAG_KEYS = ["provider", "operation", "status", "reason", "version", "route", "kind"];

/**
 * Reports a failure the code handled itself (a fallback, a skipped step, an unavailable service). It always writes a log line, and it sends one
 * scrubbed event to Sentry, grouped by event and error type, at most once a minute per group so a burst (60 rate-limited calls) is one event, not 60.
 * It never throws, so it is safe inside a catch block.
 */
export function reportFailure(event: string, error: unknown, fields: LogFields = {}, options: { level?: "warning" | "error"; userId?: string } = {}) {
  try {
    const detail = describeError(error);
    logEvent(options.level === "error" ? "error" : "warn", event, { ...fields, ...detail });

    const group = [event, detail.errorName, detail.status, fields.provider, fields.operation].filter((part) => part !== undefined).join("|");
    const now = Date.now();
    const previous = lastSent.get(group);
    if (previous !== undefined && now - previous < THROTTLE_MS) return;
    lastSent.set(group, now);
    if (lastSent.size > 500) lastSent.delete(lastSent.keys().next().value as string);

    // A synthetic error keeps the stack (code locations) but not the original message.
    const safe = new Error(`${event}: ${detail.errorName}${detail.status ? ` ${detail.status}` : ""}`);
    safe.name = "HandledFailure";
    const stack = error instanceof Error ? error.stack : undefined;
    if (stack) safe.stack = [`${safe.name}: ${safe.message}`, ...stack.split("\n").slice(1)].join("\n");

    Sentry.withScope((scope) => {
      scope.setLevel(options.level ?? "warning");
      scope.setFingerprint([event, detail.errorName, String(detail.status ?? "")]);
      scope.setTag("event", event);
      scope.setTag("error_name", detail.errorName);
      for (const key of TAG_KEYS) {
        const value = fields[key] ?? (detail as Record<string, Field>)[key];
        if (value !== undefined && value !== null) scope.setTag(key, String(value).slice(0, 64));
      }
      if (options.userId) scope.setUser({ id: options.userId });
      Sentry.captureException(safe);
    });
  } catch { /* Reporting must never make a failure worse. */ }
}

export function resetReportThrottleForTest() {
  lastSent.clear();
}
