/** Server progress is structured; never infer automatic actions from assistant prose. */
export type ScanProgress = { conversationId?: string; checked: number; found: number; retryAt: number; canContinue: boolean; label: string; checkpoint: string };
export function readScan(value: unknown): ScanProgress | undefined {
  if (!value || typeof value !== "object") return;
  const scan = value as ScanProgress;
  if (!Number.isFinite(scan.checked) || !Number.isFinite(scan.found) || !Number.isFinite(scan.retryAt) || typeof scan.canContinue !== "boolean" || typeof scan.label !== "string" || typeof scan.checkpoint !== "string") return;
  return scan;
}

/** Bound unattended work even if a provider keeps returning the same failed batch. */
export function nextScanStep(scan: ScanProgress, previous: string | undefined, stalled: number, batches: number, now = Date.now()) {
  const stalls = scan.checkpoint === previous ? stalled + 1 : 0;
  return { stalled: stalls, continue: scan.canContinue && stalls < 3 && batches < 30, delayMs: Math.max(1500, scan.retryAt - now) };
}

export function waitForScan(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Stopped", "AbortError")); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException("Stopped", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
