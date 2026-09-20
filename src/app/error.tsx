"use client";

import { useEffect } from "react";
import { StatusPage } from "@/components/layout/StatusPage";
import { Button, ButtonLink } from "@/components/ui/Button";

/** Shown when a page fails while rendering. Nothing about the error itself is shown to the user; the digest lets us find it in the logs. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("page_render_failed", error.digest ?? "no-digest"); }, [error]);
  return <StatusPage title="Something went wrong" actions={<>
    <Button variant="primary" onClick={reset}>Try again</Button>
    <ButtonLink href="/">Go to Daylark</ButtonLink>
  </>}>
    That page couldn’t load. Nothing was changed. Trying again usually works.{error.digest ? ` (Reference ${error.digest})` : ""}
  </StatusPage>;
}
