import type { ErrorEvent, EventHint } from "@sentry/nextjs";

export function sanitizeSentryEvent(event: ErrorEvent, _hint: EventHint): ErrorEvent {
  // Reconstruct the event: unknown SDK fields, extras, URLs, messages, headers and contexts cannot leak.
  return {
    type: undefined,
    event_id: event.event_id, timestamp: event.timestamp, platform: event.platform,
    level: event.level, release: event.release, environment: event.environment,
    exception: event.exception ? { values: event.exception.values?.map(value => ({
      type: "RedactedError", value: "Error details withheld for privacy",
      stacktrace: { frames: value.stacktrace?.frames?.map(frame => ({
        filename: frame.filename?.includes("/_next/") ? `/_next/${frame.filename.split("/_next/").at(-1)?.split(/[?#]/)[0]}` : undefined,
        lineno: frame.lineno, colno: frame.colno, in_app: frame.in_app,
      })) },
    })) } : undefined,
  };
}

export function validOtlpEndpoint(value: string | undefined) {
  if (!value || value.includes("<") || value.includes(">")) return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}
