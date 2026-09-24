import { afterEach, expect, it, vi } from "vitest";
import { nextScanStep, readScan, waitForScan } from "./scan-continuation";
const progress = { checked: 19, found: 4, retryAt: 20000, canContinue: true, label: "Checking…", checkpoint: "19:1:0:4:4" };
afterEach(() => vi.useRealTimers());
it("continues a saved batch and honors Gmail's cooldown", () => {
  expect(nextScanStep(progress, undefined, 0, 0, 10000)).toEqual({ stalled: 0, continue: true, delayMs: 10000 });
  expect(nextScanStep({ ...progress, retryAt: 0 }, undefined, 0, 0, 10000).delayMs).toBe(1500);
});
it("stops after three unchanged checkpoints and caps unattended batches", () => {
  expect(nextScanStep(progress, progress.checkpoint, 2, 3).continue).toBe(false);
  expect(nextScanStep(progress, "older", 2, 30).continue).toBe(false);
  expect(nextScanStep({ ...progress, canContinue: false }, undefined, 0, 0).continue).toBe(false);
  expect(nextScanStep(progress, "older", 2, 3).stalled).toBe(0);
});
it("never interprets assistant prose as instructions to continue", () => {
  expect(readScan("Choose **Continue scan**")).toBeUndefined();
  expect(readScan({ ...progress, retryAt: "tomorrow" })).toBeUndefined();
  expect(readScan(progress)).toEqual(progress);
});
it("Stop interrupts cooldown without another request", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const waiting = waitForScan(60000, controller.signal);
  controller.abort();
  await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  expect(vi.getTimerCount()).toBe(0);
});
