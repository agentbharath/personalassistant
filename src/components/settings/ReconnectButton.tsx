"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { startGoogleSignIn } from "@/lib/auth/google-signin";

/** Sends the user through Google again, which refreshes both permissions. */
export function ReconnectButton({ label }: { label: string }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return <>
    <Button size="sm" variant="secondary" disabled={pending} onClick={async () => { setPending(true); setFailed(false); if (await startGoogleSignIn()) { setPending(false); setFailed(true); } }}>{pending ? "Opening Google…" : label}</Button>
    {failed && <span role="alert" style={{ marginLeft: "var(--s-2)", color: "var(--muted)", fontSize: "var(--text-xs)" }}>Couldn’t start. Try again.</span>}
  </>;
}
