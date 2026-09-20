"use client";

import { useTransition, type FormEvent, type ReactNode } from "react";
import { useToast } from "@/components/ui/Toast";
import styles from "./ActionForm.module.css";

/**
 * A form that runs a server action and says what happened: a toast on success or failure, and `data-pending` on the form while it runs so its
 * buttons can show "Saving…". Works with the button that was pressed (its name and value are sent), and the fields stay as the person left them.
 */
export function ActionForm({ action, success, failure = "Couldn’t save that. Try again.", className, children }: { action: (formData: FormData) => Promise<void>; success: string; failure?: string; className?: string; children: ReactNode }) {
  const { toast } = useToast();
  const [pending, start] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const data = new FormData(event.currentTarget, submitter);
    start(async () => {
      try { await action(data); toast({ message: success }); }
      catch { toast({ message: failure, tone: "notice" }); }
    });
  }

  return <form className={[styles.form, className].filter(Boolean).join(" ")} onSubmit={submit} aria-busy={pending} data-pending={pending || undefined}>{children}<span className={styles.status} role="status">{pending ? "Saving…" : ""}</span></form>;
}
