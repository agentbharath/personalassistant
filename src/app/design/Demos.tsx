"use client";

import { useState } from "react";
import { Composer } from "@/components/chat/Composer";
import { FindBar } from "@/components/chat/FindBar";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PinIcon, EditIcon, TrashIcon } from "@/components/ui/icons";
import { Menu } from "@/components/ui/Menu";
import { useToast } from "@/components/ui/Toast";

/** Interactive samples of the components that need state. Development only. */
export function Demos() {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [query, setQuery] = useState("total");

  return <>
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-3)", alignItems: "center" }}>
      <Menu label="Sample menu" items={[
        { label: "Pin to top", icon: <PinIcon />, onSelect: () => toast({ message: "Pinned" }) },
        { label: "Rename", icon: <EditIcon />, onSelect: () => toast({ message: "Rename" }) },
        { label: "Delete", icon: <TrashIcon />, onSelect: () => setConfirming(true) },
      ]} />
      <Button onClick={() => setConfirming(true)}>Confirm dialog</Button>
      <Button onClick={() => toast({ message: "Something changed" })}>Toast</Button>
      <Button onClick={() => toast({ message: "You can pin up to 5 chats. Unpin one first.", tone: "notice" })}>Notice toast</Button>
      <Button onClick={() => toast({ message: "Conversation deleted", durationMs: 5000, showProgress: true, action: { label: "Undo", onAction: () => undefined } })}>Undo toast</Button>
    </div>
    {confirming && <ConfirmDialog title="Delete this chat?" confirmLabel="Delete" onCancel={() => setConfirming(false)} onConfirm={() => setConfirming(false)}>“Total spending so far” will be permanently removed.</ConfirmDialog>}
    <div style={{ marginTop: "var(--s-6)" }}><FindBar query={query} onQuery={setQuery} count={3} position={1} onStep={() => undefined} onClose={() => undefined} /></div>
    <div style={{ position: "relative", marginTop: "var(--s-4)", minHeight: "9rem" }}>
      <Composer value={text} onChange={setText} onSubmit={(event) => event.preventDefault()} attachment={file} onAttach={setFile} pending={false} listening={false} voiceMessage={null} onToggleVoice={() => undefined} onStop={() => undefined} onShortcuts={() => undefined} onRecall={() => undefined} />
    </div>
  </>;
}
