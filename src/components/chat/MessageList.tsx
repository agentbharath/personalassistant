"use client";

import { useEffect, useState, type RefObject } from "react";
import { Button } from "@/components/ui/Button";
import { windowMessages } from "@/lib/ui/grouping";
import { AssistantMessage, PendingMessage, UserMessage } from "./Message";
import styles from "./MessageList.module.css";
import { answerChoices, followUps, hasApprovalActions, hasScanActions, type Message } from "./types";

const VISIBLE = 120;
const STEP = 120;

type Props = {
  messages: Message[];
  pending: boolean;
  progress: string;
  takingLonger: boolean;
  hasEarlierMessages: boolean;
  loadingEarlier: boolean;
  earlierError?: boolean;
  ratings: Record<string, 1 | -1>;
  /** Indexes of messages matching the find bar, and which one is current. */
  matches: number[];
  activeMatch: number | null;
  onLoadEarlier: () => void;
  onAction: (action: "confirm" | "cancel" | "retry" | "continue_scan") => void;
  onFollowUp: (text: string) => void;
  onRate: (message: Message, rating: 1 | -1) => void;
  onNote: (message: Message, note: string) => Promise<boolean>;
  endRef: RefObject<HTMLDivElement | null>;
};

export function MessageList({ messages, pending, progress, takingLonger, hasEarlierMessages, loadingEarlier, earlierError, ratings, matches, activeMatch, onLoadEarlier, onAction, onFollowUp, onRate, onNote, endRef }: Props) {
  const [visible, setVisible] = useState(VISIBLE);
  const { shown, hidden, offset } = windowMessages(messages, visible);
  const lastIndex = messages.length - 1;
  const choices = pending ? [] : answerChoices(messages[lastIndex]);
  // A question with choices takes the place of the usual next-step suggestions.
  const suggestions = pending || choices.length ? [] : followUps(messages[lastIndex]);

  // Jump to the current find match, revealing it first if it is in the hidden older part.
  useEffect(() => {
    if (activeMatch === null) return;
    const needed = messages.length - activeMatch;
    if (needed > visible) { setVisible(needed + 20); return; }
    document.getElementById(`message-${activeMatch}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeMatch, messages.length, visible]);

  return <div className={styles.list} aria-live="polite" aria-relevant="additions">
    {hidden > 0 && <Button className={styles.earlier} size="sm" onClick={() => setVisible((current) => current + STEP)}>Show {Math.min(hidden, STEP)} earlier messages</Button>}
    {hidden === 0 && hasEarlierMessages && <Button className={styles.earlier} size="sm" disabled={loadingEarlier} onClick={onLoadEarlier}>{loadingEarlier ? "Loading…" : earlierError ? "Couldn’t load earlier messages · Try again" : "Load earlier messages"}</Button>}
    {shown.map((message, index) => {
      const absolute = offset + index;
      const highlight = activeMatch === absolute ? "active" : matches.includes(absolute) ? "match" : undefined;
      const id = `message-${absolute}`;
      if (message.role === "user") return <UserMessage key={message.sequence ? `s${message.sequence}` : `i${absolute}`} id={id} highlight={highlight} busy={pending} onResend={() => onFollowUp(message.content)}>{message.content}</UserMessage>;
      const latest = absolute === lastIndex;
      return <AssistantMessage
        key={message.sequence ? `s${message.sequence}` : `i${absolute}`}
        id={id}
        highlight={highlight}
        notice={message.notice}
        approval={latest && hasApprovalActions(message.content)}
        resumable={latest && hasScanActions(message.content)}
        retryable={latest && message.retryable}
        busy={pending}
        canRate={Boolean(message.sequence)}
        rating={message.sequence ? ratings[message.sequence] : undefined}
        onRate={(rating) => onRate(message, rating)}
        onNote={(note) => onNote(message, note)}
        onConfirm={() => onAction("confirm")}
        onContinue={() => onAction("continue_scan")}
        onCancel={() => onAction("cancel")}
        onRetry={() => onAction("retry")}
      >{message.content}</AssistantMessage>;
    })}
    {pending && <PendingMessage label={progress} takingLonger={takingLonger} />}
    {choices.length > 0 && <div className={styles.suggestions} role="group" aria-label="Choose an answer">
      {choices.map((text) => <button key={text} type="button" className={styles.chip} onClick={() => onFollowUp(text)}>{text}</button>)}
    </div>}
    {suggestions.length > 0 && <div className={styles.suggestions} role="group" aria-label="Suggested follow-ups">
      {suggestions.map((text) => <button key={text} type="button" className={styles.chip} onClick={() => onFollowUp(text)}>{text}</button>)}
    </div>}
    <div ref={endRef} className={styles.end} />
  </div>;
}
