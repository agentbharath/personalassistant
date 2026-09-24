"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { readScan, nextScanStep, waitForScan } from "./scan-continuation";
import { streamChat } from "./stream-chat";
import { progressLabel, type Message } from "./types";

type Options = { initialInput?: string; conversationId?: string; initialMessages: Message[]; initialHasMore: boolean; initialOldestSequence?: string };

const draftKey = (conversationId?: string) => `daylark-draft:${conversationId ?? "new"}`;
const readDraft = (conversationId?: string) => { try { return localStorage.getItem(draftKey(conversationId)) ?? ""; } catch { return ""; } };
const writeDraft = (conversationId: string | undefined, text: string) => {
  try { if (text) localStorage.setItem(draftKey(conversationId), text); else localStorage.removeItem(draftKey(conversationId)); } catch { /* storage unavailable: drafts are a convenience */ }
};

/** All chat state and network behavior. The components below are purely presentational. */
export function useChat({ conversationId: initialConversationId, initialMessages, initialHasMore, initialOldestSequence, initialInput = "" }: Options) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [input, setInputState] = useState(initialInput);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState("");
  const [takingLonger, setTakingLonger] = useState(false);
  const [hasEarlierMessages, setHasEarlierMessages] = useState(initialHasMore);
  const [oldestSequence, setOldestSequence] = useState(initialOldestSequence);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierError, setEarlierError] = useState(false);
  const [ratings, setRatings] = useState<Record<string, 1 | -1>>({});
  const pendingRef = useRef(false);
  const scanControl = useRef<{ conversationId?: string; inFlight: boolean; stopping: boolean }>({ inFlight: false, stopping: false });
  const abortRef = useRef<AbortController | null>(null);
  const skipAutoScrollRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const beforeSend = useRef<() => void>(() => undefined);

  useEffect(() => () => abortRef.current?.abort(), []);

  function setInput(text: string) { setInputState(text); writeDraft(conversationId, text); }

  // Restore what was half-typed in this conversation.
  useEffect(() => { const draft = readDraft(initialConversationId); if (draft && !initialInput) setInputState(draft); }, [initialConversationId, initialInput]);

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

  async function sendMessage(action?: "confirm" | "cancel" | "retry" | "continue_scan", override?: string) {
    const retrying = action === "retry";
    const selectedAttachment = action || override ? null : attachment;
    const typedMessage = override ?? (retrying ? [...messages].reverse().find(message => message.role === "user")?.content ?? "Try again" : action === "continue_scan" ? "Continue scan" : action) ?? input.trim();
    const message = selectedAttachment ? `Import receipt: ${selectedAttachment.name}` : typedMessage;
    if ((!typedMessage && !selectedAttachment) || pendingRef.current) return;
    beforeSend.current();
    pendingRef.current = true;
    setMessages((current) => [...current, { role: "user", content: message }]);
    if (!override && !action) { setInputState(""); writeDraft(conversationId, ""); }
    setPending(true);
    setProgress(progressLabel([]));
    setTakingLonger(false);
    const slowTimer = window.setTimeout(() => setTakingLonger(true), 8_000);
    const controller = new AbortController();
    abortRef.current = controller;
    let scanning = false;
    scanControl.current = { inFlight: true, stopping: false };
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
        ({ status, body } = await streamChat({ message, conversationId, isRetry: retrying && Boolean(conversationId), uiAction: action === "confirm" || action === "cancel" || action === "continue_scan" ? action : undefined }, controller.signal, (agents, scan) => { if (scan) { scanning = true; scanControl.current.conversationId = scan.conversationId ?? conversationId; if (scan.conversationId) setConversationId(scan.conversationId); } setProgress(scanControl.current.stopping ? "Pausing scan and saving progress…" : scan?.label ?? progressLabel(agents)); if (scan) setTakingLonger(false); }));
      }
      scanControl.current.inFlight = false;
      let scan = readScan(body?.scan);
      let scanConversation = typeof body?.conversationId === "string" ? body.conversationId : conversationId;
      let previous: string | undefined;
      let stalled = 0;
      let batches = 0;
      while (status < 400 && scan?.canContinue && scanConversation) {
        if (scanControl.current.stopping) {
          body = { ...body, answer: "Scan paused and progress saved. Choose **Continue scan** when you’re ready. Nothing was imported." };
          break;
        }
        scanning = true;
        window.clearTimeout(slowTimer);
        setTakingLonger(false);
        setConversationId(scanConversation);
        scanControl.current.conversationId = scanConversation;
        const next = nextScanStep(scan, previous, stalled, batches);
        if (!next.continue) {
          body = { ...body, answer: `Your scan progress is saved. ${scan.checked} emails checked and ${scan.found} records found. ${stalled >= 2 ? "Some emails are still unavailable." : "This is a large scan."} Choose **Continue scan** to pick up where I stopped. Nothing has been imported.` };
          break;
        }
        previous = scan.checkpoint;
        stalled = next.stalled;
        batches++;
        setProgress(scan.label);
        await waitForScan(next.delayMs, controller.signal);
        scanControl.current.inFlight = true;
        ({ status, body } = await streamChat({ message: "Continue scan", conversationId: scanConversation, isRetry: false, uiAction: "continue_scan", automaticContinuation: true }, controller.signal, (agents, update) => setProgress(scanControl.current.stopping ? "Pausing scan and saving progress…" : update?.label ?? scan!.label ?? progressLabel(agents))));
        scanControl.current.inFlight = false;
        scan = readScan(body?.scan);
        scanConversation = typeof body?.conversationId === "string" ? body.conversationId : scanConversation;
      }
      const failed = status >= 400 || !body || (typeof body.error === "string" && body.answer === undefined);
      const newConversationId = typeof body?.conversationId === "string" ? body.conversationId : undefined;
      if (newConversationId && !conversationId) {
        writeDraft(newConversationId, readDraft(undefined));
        writeDraft(undefined, "");
        setConversationId(newConversationId);
        router.replace(`/?conversation=${newConversationId}`, { scroll: false });
        router.refresh();
      }
      const text = String(body?.answer ?? body?.message ?? "").trim() || "I couldn’t produce an answer this time. Please try again.";
      setMessages((current) => [...current, {
        role: "assistant",
        content: [text, body?.persistenceWarning].filter(Boolean).join("\n\n"),
        retryable: body?.retryable === true,
        notice: failed,
        sequence: typeof body?.sequence === "string" ? body.sequence : undefined,
        agents: Array.isArray(body?.agents) ? (body.agents as string[]) : undefined,
        status: typeof body?.status === "string" ? body.status : undefined,
        choices: Array.isArray(body?.choices) ? (body.choices as unknown[]).filter((choice): choice is string => typeof choice === "string") : undefined,
      }]);
      setAttachment(null);
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        setMessages((current) => [...current, { role: "assistant", content: scanning ? "Scan paused. Your progress is saved; choose **Continue scan** when you’re ready. Nothing was imported." : "Stopped waiting. The request may still finish; reopen this chat to check before sending it again.", notice: true, retryable: scanning }]);
      } else {
        setMessages((current) => [...current, { role: "assistant", content: scanning ? "Your connection was interrupted. Scan progress is saved; choose **Continue scan** when you’re back online. Nothing was imported." : "The connection was interrupted before I could confirm the result. Reopen this chat to check whether the request finished before sending it again.", notice: true, retryable: scanning }]);
      }
    } finally {
      window.clearTimeout(slowTimer);
      abortRef.current = null;
      scanControl.current.inFlight = false;
      pendingRef.current = false;
      setPending(false);
      setTakingLonger(false);
    }
  }

  /** Stop waiting locally; a server request may already be running or finished. Scans support a saved pause. */
  async function stop() {
    const control = scanControl.current;
    if (!control.inFlight || !control.conversationId) { abortRef.current?.abort(); return; }
    if (control.stopping) return;
    control.stopping = true;
    setProgress("Pausing scan and saving progress…");
    setTakingLonger(false);
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Pause scan", conversationId: control.conversationId, uiAction: "pause_scan" }) });
      if (!response.ok) throw new Error("pause failed");
    } catch { control.stopping = false; setProgress("Couldn’t request a pause. Please press Stop again."); }
  }

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
    setEarlierError(false);
    const previousHeight = document.documentElement.scrollHeight;
    try {
      const response = await fetch(`/api/conversations/${conversationId}/messages?before=${encodeURIComponent(oldestSequence)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("HISTORY_UNAVAILABLE");
      const body = await response.json() as { messages?: Message[]; hasMore?: boolean; oldestSequence?: string };
      skipAutoScrollRef.current = true;
      setMessages((current) => [...(body.messages ?? []), ...current]);
      setHasEarlierMessages(Boolean(body.hasMore));
      setOldestSequence(body.oldestSequence);
      requestAnimationFrame(() => window.scrollBy({ top: document.documentElement.scrollHeight - previousHeight, behavior: "auto" }));
    } catch {
      setEarlierError(true);
    } finally {
      setLoadingEarlier(false);
    }
  }

  return { messages, input, setInput, attachment, setAttachment, pending, progress, takingLonger, hasEarlierMessages, loadingEarlier, earlierError, ratings, endRef, beforeSend, sendMessage, stop, submit, rate, saveNote, loadEarlier };
}
