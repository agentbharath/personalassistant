import * as Sentry from "@sentry/nextjs";
import { validOtlpEndpoint } from "./lib/observability/sentry-privacy";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
    if (validOtlpEndpoint(process.env.OTEL_EXPORTER_OTLP_ENDPOINT)) {
      const { registerOTel } = await import("@vercel/otel");
      registerOTel({ serviceName: "daylark-assistant" });
    }
  }
  if (process.env.NEXT_RUNTIME === "edge") await import("../sentry.edge.config");
}

export const onRequestError = Sentry.captureRequestError;
