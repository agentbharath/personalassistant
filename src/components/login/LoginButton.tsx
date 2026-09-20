"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { startGoogleSignIn } from "@/lib/auth/google-signin";

export function LoginButton({ next }: { next?: string }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signIn() {
    setPending(true);
    setFailed(false);
    if (await startGoogleSignIn(next)) { setPending(false); setFailed(true); }
  }

  return <>
    <Button variant="primary" block onClick={signIn} disabled={pending}>{pending ? "Connecting…" : "Continue with Google"}</Button>
    {failed && <p role="alert" style={{ marginTop: "var(--s-3)", color: "var(--danger)", fontSize: "var(--text-sm)" }}>We couldn’t start Google sign-in. Try again.</p>}
  </>;
}
