"use client";

import { useEffect, useRef, useState } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { CheckIcon, CopyIcon, RetryIcon, ThumbDownIcon, ThumbUpIcon } from "@/components/ui/icons";
import { Markdown } from "./Markdown";
import styles from "./Message.module.css";

/** Your own message, with Copy and Ask again underneath. Ask again sends the same words as a new message. */
export function UserMessage({ children, id, highlight, busy, onResend }: { children: string; id?: string; highlight?: "match" | "active"; busy?: boolean; onResend?: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch { /* clipboard blocked: nothing to do */ }
  }
  return <div className={styles.userGroup}>
    <article id={id} className={`${styles.user} ${highlight ? styles[highlight] : ""}`} aria-label="You said">{children}</article>
    <div className={styles.userTools}>
      <span className={styles.copied} role="status">{copied ? "Copied" : ""}</span>
      <IconButton size="sm" label={copied ? "Copied" : "Copy message"} onClick={copy}>{copied ? <CheckIcon width={15} height={15} /> : <CopyIcon width={15} height={15} />}</IconButton>
      {onResend && <IconButton size="sm" label="Ask again" disabled={busy} onClick={onResend}><RetryIcon width={15} height={15} /></IconButton>}
    </div>
  </div>;
}

type AssistantProps = {
  children: string;
  id?: string;
  highlight?: "match" | "active";
  approval?: boolean;
  resumable?: boolean;
  onContinue?: () => void;
  retryable?: boolean;
  notice?: boolean;
  busy?: boolean;
  rating?: 1 | -1;
  canRate?: boolean;
  onRate?: (rating: 1 | -1) => void;
  onNote?: (note: string) => Promise<boolean>;
  onConfirm?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
};

export function AssistantMessage({ children, id, highlight, approval, resumable, onContinue, retryable, notice, busy, rating, canRate, onRate, onNote, onConfirm, onCancel, onRetry }: AssistantProps) {
  const [copied, setCopied] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLFormElement>(null);
  const [noteState, setNoteState] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  // The message bar floats over the bottom of the page, so bring the note into view above it.
  useEffect(() => { if (noteOpen) noteRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [noteOpen]);

  async function saveNote() {
    setNoteState("saving");
    const ok = await onNote?.(note.trim());
    setNoteState(ok ? "saved" : "failed");
    if (ok) setNoteOpen(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch { /* clipboard blocked: nothing to do */ }
  }

  return <article id={id} className={`${styles.assistant} ${highlight ? styles[highlight] : ""}`} aria-label={notice ? "Daylark notice" : "Daylark replied"}>
    <header className={styles.head}>Daylark</header>
    <div className={notice ? styles.notice : undefined}><Markdown>{children}</Markdown></div>
    {(approval || resumable) && <div className={styles.actions}>
      {resumable && <Button variant="primary" disabled={busy} onClick={onContinue}>Continue scan</Button>}
      {approval && <Button variant={resumable ? "secondary" : "primary"} disabled={busy} onClick={onConfirm}><CheckIcon width={16} height={16} />{resumable ? "Import reviewed items" : "Confirm"}</Button>}
      <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
    </div>}
    {retryable && <div className={styles.actions}><Button variant="secondary" disabled={busy} onClick={onRetry}>Try again</Button></div>}
    {!notice && <div className={styles.tools}>
      <IconButton size="sm" label={copied ? "Copied" : "Copy answer"} onClick={copy}>{copied ? <CheckIcon width={15} height={15} /> : <CopyIcon width={15} height={15} />}</IconButton>
      {canRate && <>
        <IconButton size="sm" label="Good answer" aria-pressed={rating === 1} className={rating === 1 ? styles.rated : undefined} onClick={() => onRate?.(1)}><ThumbUpIcon width={15} height={15} /></IconButton>
        <IconButton size="sm" label="Bad answer" aria-pressed={rating === -1} className={rating === -1 ? styles.rated : undefined} onClick={() => { const removing = rating === -1; onRate?.(-1); setNoteOpen(!removing); setNoteState("idle"); }}><ThumbDownIcon width={15} height={15} /></IconButton>
      </>}
      <span className={styles.copied} role="status">{copied ? "Copied" : noteState === "saved" ? "Thanks, saved" : ""}</span>
    </div>}
    {noteOpen && <form ref={noteRef} className={styles.note} onSubmit={(event) => { event.preventDefault(); void saveNote(); }}>
      <label htmlFor={`${id}-note`}>What was wrong? <span>Optional</span></label>
      <textarea id={`${id}-note`} value={note} maxLength={500} rows={2} autoFocus onChange={(event) => setNote(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setNoteOpen(false); } }} />
      <div className={styles.noteActions}>
        <Button type="submit" size="sm" variant="primary" disabled={noteState === "saving" || !note.trim()}>{noteState === "saving" ? "Saving…" : "Save"}</Button>
        <Button size="sm" variant="ghost" onClick={() => setNoteOpen(false)}>Skip</Button>
        {noteState === "failed" && <span role="alert" className={styles.copied}>Couldn’t save that. Try again.</span>}
      </div>
    </form>}
  </article>;
}

export function PendingMessage({ label, takingLonger }: { label: string; takingLonger: boolean }) {
  return <article className={styles.assistant} aria-label="Daylark is working">
    <header className={styles.head}>Daylark</header>
    <div className={styles.pending} role="status">
      <span className={styles.dots} aria-hidden="true"><i /><i /><i /></span>
      <span>{takingLonger && !label.includes("emails checked") ? "This is taking a little longer than usual…" : label}</span>
    </div>
  </article>;
}
