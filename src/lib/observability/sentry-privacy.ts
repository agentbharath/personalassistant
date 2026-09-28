import type { ErrorEvent, EventHint } from "@sentry/nextjs";

export function sanitizeSentryEvent(event: ErrorEvent, _hint: EventHint): ErrorEvent {
  if (event.request) {
    event.request.data = undefined;
    event.request.cookies = undefined;
    if (event.request.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.cookie;
      delete event.request.headers["x-forwarded-for"];
    }
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
  event.breadcrumbs = event.breadcrumbs?.map((breadcrumb) => ({ ...breadcrumb, message: undefined, data: undefined }));
  return event;
}

export function validOtlpEndpoint(value: string | undefined) {
  if (!value || value.includes("<") || value.includes(">")) return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}
