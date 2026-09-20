"use client";

import { useState, useTransition } from "react";
import { forgetEverything, forgetLearning } from "@/app/settings/actions";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/** After something is forgotten its row disappears, so send focus to the section heading instead of losing it. */
function focusSection() { requestAnimationFrame(() => document.getElementById("learned")?.focus()); }

/** Forgets one learned preference, after asking. */
export function ForgetButton({ id, what }: { id: string; what: string }) {
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  return <>
    <Button size="sm" variant="secondary" onClick={() => setAsking(true)}>Forget</Button>
    {asking && <ConfirmDialog title="Forget this?" confirmLabel="Forget" busy={pending} onCancel={() => setAsking(false)}
      onConfirm={() => start(async () => { const data = new FormData(); data.set("id", id); await forgetLearning(data); setAsking(false); focusSection(); })}>
      Daylark will stop doing this: “{what}”. It will go back to the default until you teach it again.
    </ConfirmDialog>}
  </>;
}

/** Forgets everything learned, after asking. */
export function ForgetAll() {
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  return <>
    <div style={{ marginTop: "var(--s-4)" }}><Button variant="secondary" size="sm" onClick={() => setAsking(true)}>Forget everything</Button></div>
    {asking && <ConfirmDialog title="Forget everything?" confirmLabel="Forget everything" busy={pending} onCancel={() => setAsking(false)}
      onConfirm={() => start(async () => { await forgetEverything(); setAsking(false); focusSection(); })}>
      Daylark will forget every preference it has learned from your corrections. This can’t be undone.
    </ConfirmDialog>}
  </>;
}
