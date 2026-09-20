import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typedRoutes: true,
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
