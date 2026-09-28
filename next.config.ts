import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typedRoutes: true,
  // Pages read live data, so each visit renders on the server. Keep a visited page for 30 seconds in the browser so moving between pages is
  // instant instead of showing the loading skeleton every time. Changes (a sent message, a deletion) call router.refresh(), which clears it.
  experimental: { staleTimes: { dynamic: 30 } },
  // The daily view was first called Today; keep old links working.
  async redirects() {
    return [{ source: "/today", destination: "/perch", permanent: false }];
  },
};

const shouldUploadSentrySourceMaps = Boolean(
  process.env.SENTRY_AUTH_TOKEN
  && process.env.SENTRY_ORG
  && process.env.SENTRY_PROJECT
  && (process.env.CI === "true" || process.env.VERCEL),
);

export default shouldUploadSentrySourceMaps
  ? withSentryConfig(nextConfig, { silent: true, org: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT })
  : nextConfig;
