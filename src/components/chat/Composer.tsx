"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { CloseIcon, KeyboardIcon, MicIcon, PaperclipIcon, SendIcon, StopIcon } from "@/components/ui/icons";
import { attachmentProblem, formatBytes } from "@/lib/ui/attachments";
import styles from "./Composer.module.css";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  attachment: File | null;
  onAttach: (file: File | null) => void;
  pending: boolean;
  listening: boolean;
  voiceMessage: string | null;
  onToggleVoice: () => void;
  onStop: () => void;
  onShortcuts: () => void;
  /** Up arrow in an empty box brings back the last message you sent. */
  onRecall: () => void;
  fieldRef?: RefObject<HTMLTextAreaElement | null>;
};

export function Composer({ value, onChange, onSubmit, attachment, onAttach, pending, listening, voiceMessage, onToggleVoice, onStop, onShortcuts, onRecall, fieldRef: externalRef }: Props) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const fieldRef = externalRef ?? ownRef;
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // A thumbnail for images; the object URL is released when the attachment changes.
  useEffect(() => {
    if (!attachment || !attachment.type.startsWith("image/")) { setPreview(null); return; }
    const url = URL.createObjectURL(attachment);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [attachment]);

  function accept(file: File | undefined) {
    if (!file || pending) return;
    const reason = attachmentProblem(file);
    setProblem(reason);
    if (!reason) onAttach(file);
    if (fileRef.current) fileRef.current.value = "";
  }
  function onDrop(event: DragEvent) { event.preventDefault(); setDragging(false); accept(event.dataTransfer.files[0]); }
  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const file = Array.from(event.clipboardData.files)[0];
    if (file) { event.preventDefault(); accept(file); }
  }

  // The message bar sits at the bottom, so notifications rise above it while it is on screen.
  useEffect(() => {
    document.documentElement.style.setProperty("--toast-bottom", "8rem");
    return () => { document.documentElement.style.removeProperty("--toast-bottom"); };
  }, []);

  // Grow with the text, up to the CSS max-height.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [value]);

  // No autofocus on load, so the page's tab order starts at the skip link. After a send, the button that was
  // pressed is disabled and focus would fall to the page, so bring it back to the message box.
  useEffect(() => {
    if (!pending && document.activeElement === document.body) fieldRef.current?.focus({ preventScroll: true });
  }, [pending, fieldRef]);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "ArrowUp" && !value && !event.nativeEvent.isComposing) { event.preventDefault(); onRecall(); return; }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function clearAttachment() { onAttach(null); setProblem(null); if (fileRef.current) fileRef.current.value = ""; }

  const canSend = !pending && (value.trim().length > 0 || attachment !== null);

  return <div className={styles.dock}>
    <form className={`${styles.box} ${dragging ? styles.dragging : ""}`} onSubmit={onSubmit}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
      onDrop={onDrop}>
      {dragging && <p className={styles.drop} aria-hidden="true">Drop a receipt to attach it</p>}
      <input ref={fileRef} className={styles.file} type="file" tabIndex={-1} accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => accept(event.target.files?.[0])} />
      {attachment && <div className={styles.attachment}>
        {preview ? <img className={styles.thumb} src={preview} alt="" /> : <span className={styles.fileBadge} aria-hidden="true">PDF</span>}
        <span className={styles.attachmentText}><span className={styles.attachmentName} title={attachment.name}>{attachment.name}</span><span className={styles.attachmentSize}>{formatBytes(attachment.size)}</span></span>
        <IconButton label={`Remove ${attachment.name}`} size="sm" onClick={clearAttachment}><CloseIcon width={14} height={14} /></IconButton>
      </div>}
      <textarea ref={fieldRef} className={styles.field} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} onPaste={onPaste} placeholder="Message Daylark…" aria-label="Message Daylark" maxLength={4000} rows={1} />
      <div className={styles.bar}>
        <IconButton label="Attach a receipt" disabled={pending} onClick={() => fileRef.current?.click()}><PaperclipIcon /></IconButton>
        <IconButton label={listening ? "Stop voice input" : "Start voice input"} aria-pressed={listening} className={listening ? styles.listening : undefined} disabled={pending} onClick={onToggleVoice}><MicIcon /></IconButton>
        <IconButton label="Keyboard shortcuts" onClick={onShortcuts}><KeyboardIcon /></IconButton>
        <span className={styles.spacer} />
        <span className={styles.hint} aria-hidden="true">Enter to send · Shift+Enter for a new line</span>
        {pending
          ? <Button variant="secondary" aria-label="Stop" onClick={onStop}><StopIcon width={16} height={16} />Stop</Button>
          : <Button type="submit" variant="primary" disabled={!canSend} aria-label="Send message"><SendIcon width={18} height={18} /></Button>}
      </div>
    </form>
    <p className={styles.status} role="status">{problem ?? voiceMessage ?? ""}</p>
  </div>;
}
