"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { progressLabel, type Message } from "./types";

type Options = { conversationId?: string; initialMessages: Message[]; initialHasMore: boolean; initialOldestSequence?: string };

const draftKey = (conversationId?: string) => `daylark-draft:${conversationId ?? "new"}`;
const readDraft = (conversationId?: string) => { try { return localStorage.getItem(draftKey(conversationId)) ?? ""; } catch { return ""; } };
const writeDraft = (conversationId: string | undefined, text: string) => {
  try { if (text) localStorage.setItem(draftKey(conversationId), text); else localStorage.removeItem(draftKey(conversationId)); } catch { /* storage unavailable: drafts are a convenience */ }
};

/** All chat state and network behavior. The components below are purely presentational. */
export function useChat({ conversationId: initialConversationId, initialMessages, initialHasMore, initialOldestSequence }: Options) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [input, setInputState] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState("");
  const [takingLonger, setTakingLonger] = useState(false);
  const [hasEarlierMessages, setHasEarlierMessages] = useState(initialHasMore);
  const [oldestSequence, setOldestSequence] = useState(initialOldestSequence);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [ratings, setRatings] = useState<Record<string, 1 | -1>>({});
  const pendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const skipAutoScrollRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const beforeSend = useRef<() => void>(() => undefined);

  function setInput(text: string) { setInputState(text); writeDraft(conversationId, text); }

  // Restore what was half-typed in this conversation.
  useEffect(() => { const draft = readDraft(initialConversationId); if (draft) setInputState(draft); }, [initialConversationId]);

  // Ratings the user already gave in this conversation.
  useEffect(() => {
    if (!initialConversationId) return;
    let cancelled = false;
    fetch(`/api/conversations/${initialConversationId}/feedback`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { if (!cancelled && body?.feedback) setRatings(body.feedback); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [initialConversationId]);

  useLayoutEffect(() => {
    if (skipAutoScrollRef.current) { skipAutoScrollRef.current = false; return; }
    const behavior = messages.length > initialMessages.length ? "smooth" : "auto";
    const scroll = () => {
      endRef.current?.scrollIntoView({ behavior, block: "end" });
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
    };
    scroll();
    const frame = requestAnimationFrame(scroll);
    const settle = window.setTimeout(scroll, 400);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(settle); };
  }, [messages, pending, initialMessages.length]);

  useEffect(() => { document.title = pending ? "Working… · Daylark" : "Daylark"; }, [pending]);

  async function sendMessage(action?: "confirm" | "cancel" | "retry", override?: string) {
    const retrying = action === "retry";
    const selectedAttachment = action || override ? null : attachment;
    const typedMessage = override ?? action ?? input.trim();
    const message = selectedAttachment ? `Import receipt: ${selectedAttachment.name}` : typedMessage;
    if ((!typedMessage && !selectedAttachment) || pendingRef.current) return;
    beforeSend.current();
    pendingRef.current = true;
    if (!retrying) setMessages((current) => [...current, { role: "user", content: message }]);
    if (!override) { setInputState(""); writeDraft(conversationId, ""); }
    setPending(true);
    setProgress(progressLabel([]));
    setTakingLonger(false);
    const slowTimer = window.setTimeout(() => setTakingLonger(true), 8_000);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let status = 200;
      let body: Record<string, unknown> | null;
      if (selectedAttachment) {
        const form = new FormData();
        form.set("file", selectedAttachment);
        if (conversationId) form.set("conversationId", conversationId);
        const response = await fetch("/api/finance/receipt-preview", { method: "POST", body: form, signal: controller.signal });
        status = response.status;
        body = await response.json().catch(() => null);
      } else {
        ({ status, body } = await streamChat({ message, conversationId, isRetry: retrying }, controller.signal, (agents) => setProgress(progressLabel(agents))));
      }
      const failed = status >= 400 || !body || (typeof body.error === "string" && body.answer === undefined);
      const newConversationId = typeof body?.conversationId === "string" ? body.conversationId : undefined;
      if (newConversationId && !conversationId) {
        writeDraft(undefined, "");
        setConversationId(newConversationId);
        router.replace(`/?conversation=${newConversationId}`, { scroll: false });
        router.refresh();
      }
      const text = String(body?.answer ?? body?.message ?? "I couldn’t complete that request. Nothing was changed.");
      setMessages((current) => [...current, {
        role: "assistant",
        content: [text, body?.persistenceWarning].filter(Boolean).join("\n\n"),
        retryable: body?.retryable === true,
        notice: failed,
        sequence: typeof body?.sequence === "string" ? body.sequence : undefined,
        agents: Array.isArray(body?.agents) ? (body.agents as string[]) : undefined,
        status: typeof body?.status === "string" ? body.status : undefined,
      }]);
      setAttachment(null);
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        setMessages((current) => [...current, { role: "assistant", content: "Stopped. Nothing was changed. If I had already finished, the answer will be in this chat when you reload.", notice: true, retryable: true }]);
      } else {
        setMessages((current) => [...current, { role: "assistant", content: "I couldn’t reach Daylark. Check your connection and try again. Nothing was changed.", notice: true, retryable: true }]);
      }
    } finally {
      window.clearTimeout(slowTimer);
      abortRef.current = null;
      pendingRef.current = false;
      setPending(false);
      setTakingLonger(false);
    }
  }

  /** Stops waiting for the answer. Requests are read-only until the user confirms, so nothing is left half done. */
  function stop() { abortRef.current?.abort(); }

  async function submit(event: FormEvent) { event.preventDefault(); await sendMessage(); }

  /** Adds a note to an answer already rated bad. */
  async function saveNote(message: Message, note: string) {
    if (!conversationId || !message.sequence) return false;
    try {
      const response = await fetch(`/api/conversations/${conversationId}/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sequence: message.sequence, rating: -1, note }) });
      return response.ok;
    } catch { return false; }
  }

  async function rate(message: Message, rating: 1 | -1) {
    if (!conversationId || !message.sequence) return;
    const sequence = message.sequence;
    const previous = ratings[sequence];
    const next = previous === rating ? 0 : rating;
    setRatings((current) => { const copy = { ...current }; if (next === 0) delete copy[sequence]; else copy[sequence] = next; return copy; });
    try {
      const response = await fetch(`/api/conversations/${conversationId}/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sequence, rating: next }) });
      if (!response.ok) throw new Error("failed");
    } catch {
      setRatings((current) => { const copy = { ...current }; if (previous) copy[sequence] = previous; else delete copy[sequence]; return copy; });
    }
  }

  async function loadEarlier() {
    if (!conversationId || !oldestSequence || loadingEarlier) return;
    setLoadingEarlier(true);
    const previousHeight = document.documentElement.scrollHeight;
    try {
      const response = await fetch(`/api/conversations/${conversationId}/messages?before=${encodeURIComponent(oldestSequence)}`, { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as { messages?: Message[]; hasMore?: boolean; oldestSequence?: string };
      skipAutoScrollRef.current = true;
      setMessages((current) => [...(body.messages ?? []), ...current]);
      setHasEarlierMessages(Boolean(body.hasMore));
      setOldestSequence(body.oldestSequence);
      requestAnimationFrame(() => window.scrollBy({ top: document.documentElement.scrollHeight - previousHeight, behavior: "auto" }));
    } finally {
      setLoadingEarlier(false);
    }
  }

  return { messages, input, setInput, attachment, setAttachment, pending, progress, takingLonger, hasEarlierMessages, loadingEarlier, ratings, endRef, beforeSend, sendMessage, stop, submit, rate, saveNote, loadEarlier };
}

/** Reads the NDJSON stream from /api/chat: progress lines while it works, then one result line. */
async function streamChat(payload: { message: string; conversationId?: string; isRetry: boolean }, signal: AbortSignal, onProgress: (agents: string[]) => void) {
  const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json", accept: "application/x-ndjson" }, body: JSON.stringify(payload), signal });
  if (!response.body || !response.headers.get("content-type")?.includes("ndjson")) {
    return { status: response.status, body: (await response.json().catch(() => null)) as Record<string, unknown> | null };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: { status: number; body: Record<string, unknown> | null } | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as { type: string; agents?: string[]; status?: number; body?: Record<string, unknown> | null };
    if (event.type === "progress") onProgress(event.agents ?? []);
    if (event.type === "result") result = { status: event.status ?? 500, body: event.body ?? null };
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(handle);
  }
  handle(buffer);
  return result ?? { status: 500, body: null };
}
