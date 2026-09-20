import * as Sentry from "@sentry/nextjs";
import { sanitizeSentryEvent } from "./src/lib/observability/sentry-privacy";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
  beforeSend: sanitizeSentryEvent,
});
