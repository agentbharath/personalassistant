"use client";

import { createContext, useContext, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ConversationSummary } from "@/lib/conversations/store";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

type PendingDeletion = { conversation: ConversationSummary; active: boolean };

type Override = { title?: string; pinned?: boolean; pinnedAt?: string | null };

type ConversationDeletionContextValue = {
  hiddenConversationIds: ReadonlySet<string>;
  requestDeletion: (conversation: ConversationSummary, active: boolean) => void;
  /** Applies this session's renames and pins to a list, pinned first, so lists update before the server round trip. */
  applyChanges: <T extends ConversationSummary>(items: T[]) => T[];
  renamingId: string | null;
  startRename: (id: string) => void;
  stopRename: () => void;
  rename: (id: string, title: string) => Promise<void>;
  setPinned: (id: string, pinned: boolean) => Promise<void>;
};

const ConversationDeletionContext = createContext<ConversationDeletionContextValue | null>(null);

const UNDO_MS = 5_000;

export function ConversationDeletionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { toast, dismiss } = useToast();
  const [pending, setPending] = useState<PendingDeletion | null>(null);
  const pendingToast = useRef<number | null>(null);
  const [requested, setRequested] = useState<PendingDeletion | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(new Set());

  const notify = (message: string) => toast({ message, tone: "notice", durationMs: 7_000 });

  // `optimistic: false` waits for the server first, used for pinning because the server may refuse (pin limit) and the chat must not jump and jump back.
  async function patch(id: string, change: Override, failure: string, optimistic = true) {
    const previous = overrides[id];
    const apply = () => setOverrides((current) => ({ ...current, [id]: { ...current[id], ...change } }));
    if (optimistic) apply();
    try {
      const response = await fetch(`/api/conversations/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: change.title, pinned: change.pinned }) });
      if (!response.ok) {
        const body = response.status === 409 ? await response.json().catch(() => null) as { message?: string } | null : null;
        throw new Error(body?.message ?? "PATCH_FAILED");
      }
      if (!optimistic) apply();
      router.refresh();
    } catch (error) {
      setOverrides((current) => { const next = { ...current }; if (previous) next[id] = previous; else delete next[id]; return next; });
      notify(error instanceof Error && error.message !== "PATCH_FAILED" && !/fetch|network/i.test(error.message) ? error.message : failure);
    }
  }
  const rename = (id: string, title: string) => patch(id, { title }, "Couldn’t rename that chat.");
  const setPinned = (id: string, pinned: boolean) => patch(id, { pinned, pinnedAt: pinned ? new Date().toISOString() : null }, pinned ? "Couldn’t pin that chat." : "Couldn’t unpin that chat.", !pinned);
  function applyChanges<T extends ConversationSummary>(items: T[]) {
    const changed = items.map((item) => ({ ...item, ...(overrides[item.id]?.title !== undefined ? { title: overrides[item.id].title } : {}), ...(overrides[item.id]?.pinned !== undefined ? { pinned: overrides[item.id].pinned, pinnedAt: overrides[item.id].pinnedAt ?? null } : {}) }));
    // Pinned rows first, the most recently pinned on top (the same order the server uses); everything else keeps the server's order.
    const pinned = changed.filter((item) => item.pinned).sort((a, b) => (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? ""));
    return [...pinned, ...changed.filter((item) => !item.pinned)] as T[];
  }

  // Focus is moved after the render that removes or restores the element it depends on.
  function focusAfterRender(target: () => HTMLElement | null | undefined) {
    requestAnimationFrame(() => (target() ?? document.getElementById("main"))?.focus());
  }
  const deleteButtonFor = (id: string) => document.querySelector<HTMLElement>(`[data-delete-for="${id}"]`);

  // Removes the row for good: hidden at once, then the request runs. A failure restores it.
  function commitDeletion(conversation: ConversationSummary) {
    setDeleted((current) => new Set(current).add(conversation.id));
    void (async () => {
      try {
        const response = await fetch(`/api/conversations/${conversation.id}`, { method: "DELETE" });
        if (!response.ok) throw new Error("DELETE_FAILED");
        router.refresh();
      } catch {
        setDeleted((current) => { const next = new Set(current); next.delete(conversation.id); return next; });
        notify("Couldn’t delete that conversation. It has been restored.");
      }
    })();
  }

  function confirmDeletion() {
    if (!requested) return;
    const { conversation, active } = requested;
    // Deleting a second chat inside the undo window makes the first one final now, so it isn't dropped.
    if (pending && pendingToast.current !== null) { dismiss(pendingToast.current); commitDeletion(pending.conversation); }
    setRequested(null);
    setPending({ conversation, active });
    if (active) router.push("/");

    pendingToast.current = toast({
      message: "Conversation deleted",
      durationMs: UNDO_MS,
      showProgress: true,
      focusAction: true, // the row the user just deleted is gone, so the next stop for the keyboard is Undo
      action: {
        label: "Undo",
        onAction: () => {
          setPending(null);
          pendingToast.current = null;
          if (active) router.push(`/?conversation=${conversation.id}`);
          focusAfterRender(() => deleteButtonFor(conversation.id));
        },
      },
      onExpire: () => { setPending(null); pendingToast.current = null; commitDeletion(conversation); },
      onGone: (reason, hadFocus) => { if (reason === "expire" && hadFocus) focusAfterRender(() => null); },
    });
  }

  const hiddenConversationIds = new Set([...deleted, ...(pending ? [pending.conversation.id] : [])]);

  return <ConversationDeletionContext.Provider value={{ hiddenConversationIds, requestDeletion: (conversation, active) => setRequested({ conversation, active }), applyChanges, renamingId, startRename: setRenamingId, stopRename: () => setRenamingId(null), rename, setPinned }}>
    {children}
    {requested && <ConfirmDialog title="Delete this chat?" confirmLabel="Delete" onCancel={() => setRequested(null)} onConfirm={confirmDeletion}>
      “{requested.conversation.title}” will be permanently removed. You can undo for {UNDO_MS / 1000} seconds.
    </ConfirmDialog>}
  </ConversationDeletionContext.Provider>;
}

export function useConversationDeletion() {
  const context = useContext(ConversationDeletionContext);
  if (!context) throw new Error("useConversationDeletion must be used inside ConversationDeletionProvider");
  return context;
}
