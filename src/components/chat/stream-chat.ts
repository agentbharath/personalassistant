import { readScan, type ScanProgress } from "./scan-continuation";

/** Reads the NDJSON stream from /api/chat: progress lines while it works, then one result line. */
export async function streamChat(payload: { message: string; conversationId?: string; isRetry: boolean; automaticContinuation?: boolean; uiAction?: "confirm" | "cancel" | "continue_scan" }, signal: AbortSignal, onProgress: (agents: string[], scan?: ScanProgress) => void) {
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
    const event = JSON.parse(line) as { type: string; scan?: unknown; agents?: string[]; status?: number; body?: Record<string, unknown> | null };
    if (event.type === "progress") onProgress(event.agents ?? [], readScan(event.scan));
    if (event.type === "result") result = { status: event.status ?? 500, body: event.body ?? null };
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { buffer += decoder.decode(); break; }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        handle(line);
        // The terminal result is sufficient; do not wait for a close that may never arrive.
        if (result) return result;
      }
    }
    handle(buffer);
    if (!result) throw new Error("CHAT_STREAM_INCOMPLETE");
    return result;
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
