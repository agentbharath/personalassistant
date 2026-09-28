import * as Sentry from "@sentry/nextjs";
import { sanitizeSentryEvent } from "./lib/observability/sentry-privacy";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.05 : 0,
  beforeSend: sanitizeSentryEvent,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
