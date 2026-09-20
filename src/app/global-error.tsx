"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * The last resort: the root layout itself failed, so none of the app's styles or fonts can be relied on. It reports the error and
 * shows a plain, self-contained message with inline styles.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return <html lang="en">
    <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, background: "#f7f8fa", color: "#0d1117", fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
      <main style={{ maxWidth: 400 }}>
        <h1 style={{ margin: 0, fontSize: 28, letterSpacing: "-0.03em" }}>Something went wrong</h1>
        <p style={{ color: "#565f6c", lineHeight: 1.6 }}>Daylark couldn’t load. Nothing was changed. Try again in a moment.{error.digest ? ` (Reference ${error.digest})` : ""}</p>
        <button type="button" onClick={reset} style={{ height: 38, padding: "0 16px", border: 0, borderRadius: 8, background: "#0d1117", color: "#f7f8fa", font: "inherit", fontWeight: 500, cursor: "pointer" }}>Try again</button>
      </main>
    </body>
  </html>;
}
