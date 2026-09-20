"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "@/components/ui/Button";
import { ArrowDownIcon, SearchIcon } from "@/components/ui/icons";
import { Composer } from "./Composer";
import { EmptyState } from "./EmptyState";
import { FindBar } from "./FindBar";
import styles from "./Chat.module.css";
import { MessageList } from "./MessageList";
import { ShortcutsDialog } from "./ShortcutsDialog";
import type { Message } from "./types";
import { useChat } from "./useChat";
import { useVoiceInput } from "./useVoiceInput";

type Props = { title?: string; conversationId?: string; initialMessages?: Message[]; initialHasMore?: boolean; initialOldestSequence?: string };

const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export function Chat({ title, conversationId, initialMessages = [], initialHasMore = false, initialOldestSequence }: Props) {
  const chat = useChat({ conversationId, initialMessages, initialHasMore, initialOldestSequence });
  const voice = useVoiceInput(() => chat.input, chat.setInput);
  chat.beforeSend.current = () => { voice.stop(); voice.clearMessage(); };
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const empty = chat.messages.length === 0 && !chat.pending;

  const [shortcuts, setShortcuts] = useState(false);
  const [finding, setFinding] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [current, setCurrent] = useState(0);
  const [away, setAway] = useState(false);

  const matches = useMemo(() => {
    const needle = findQuery.trim().toLowerCase();
    if (!finding || !needle) return [];
    return chat.messages.flatMap((message, index) => (message.content.toLowerCase().includes(needle) ? [index] : []));
  }, [finding, findQuery, chat.messages]);
  const activeMatch = matches.length ? matches[Math.min(current, matches.length - 1)] : null;

  const closeFind = useCallback(() => { setFinding(false); setFindQuery(""); setCurrent(0); requestAnimationFrame(() => fieldRef.current?.focus()); }, []);
  const lastUserMessage = useMemo(() => [...chat.messages].reverse().find((message) => message.role === "user")?.content, [chat.messages]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      if (event.key === "/") { event.preventDefault(); fieldRef.current?.focus(); }
      if (event.key === "?") { event.preventDefault(); setShortcuts(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Show the jump-to-latest button only once the user has scrolled well away from the bottom.
  useEffect(() => {
    const onScroll = () => setAway(document.documentElement.scrollHeight - window.scrollY - window.innerHeight > 320);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [chat.messages.length]);

  return <>
    {!empty && <h1 className="sr-only">{title ?? "Conversation"}</h1>}
    {!empty && !finding && <div className={styles.tools}><IconButton size="sm" label="Find in this chat" onClick={() => setFinding(true)}><SearchIcon width={16} height={16} /></IconButton></div>}
    {finding && <div className={styles.find}><FindBar query={findQuery} onQuery={(query) => { setFindQuery(query); setCurrent(0); }} count={matches.length} position={Math.min(current, Math.max(matches.length - 1, 0)) + 1} onStep={(direction) => setCurrent((index) => (matches.length ? (index + direction + matches.length) % matches.length : 0))} onClose={closeFind} /></div>}
    <div style={{ flex: 1 }}>
      {empty
        ? <div style={{ maxWidth: "var(--measure)", margin: "0 auto", padding: "0 var(--s-4)" }}><EmptyState onPick={(prompt) => { chat.setInput(prompt); fieldRef.current?.focus(); }} /></div>
        : <MessageList messages={chat.messages} pending={chat.pending} progress={chat.progress} takingLonger={chat.takingLonger} hasEarlierMessages={chat.hasEarlierMessages} loadingEarlier={chat.loadingEarlier} ratings={chat.ratings} matches={matches} activeMatch={activeMatch}
          onLoadEarlier={chat.loadEarlier} onAction={(action) => void chat.sendMessage(action)} onFollowUp={(text) => void chat.sendMessage(undefined, text)} onRate={(message, rating) => void chat.rate(message, rating)} onNote={chat.saveNote} endRef={chat.endRef} />}
    </div>
    {away && !empty && <button type="button" className={styles.toLatest} onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" })}><ArrowDownIcon width={16} height={16} />Latest</button>}
    <Composer value={chat.input} onChange={(text) => { chat.setInput(text); voice.clearMessage(); }} onSubmit={chat.submit} attachment={chat.attachment} onAttach={chat.setAttachment} pending={chat.pending}
      listening={voice.listening} voiceMessage={voice.voiceMessage} onToggleVoice={voice.toggle} onStop={chat.stop} onShortcuts={() => setShortcuts(true)}
      onRecall={() => { if (lastUserMessage) chat.setInput(lastUserMessage); }} fieldRef={fieldRef} />
    {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
  </>;
}
