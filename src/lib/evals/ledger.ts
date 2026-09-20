import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** R21: what has already passed against the real model, so a live run only pays for cases that are new or changed. */
export type Ledger = { version: string; verified: Record<string, string> };

export const caseHash = (value: unknown) => createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 12);

/** Cases not yet verified for this prompt version. A new prompt version makes every case pending again. */
export function pendingCases<T>(items: T[], ledger: Ledger | null, version: string, idOf: (item: T) => string, hashOf: (item: T) => string) {
  if (!ledger || ledger.version !== version) return items;
  return items.filter((item) => ledger.verified[idOf(item)] !== hashOf(item));
}

export function recordVerified<T>(ledger: Ledger | null, version: string, passed: T[], idOf: (item: T) => string, hashOf: (item: T) => string): Ledger {
  const current: Ledger = ledger && ledger.version === version ? { version, verified: { ...ledger.verified } } : { version, verified: {} };
  for (const item of passed) current.verified[idOf(item)] = hashOf(item);
  return current;
}

const ledgerPath = (name: string) => resolve(process.cwd(), "evals", "verified", `${name}.json`);

export function loadLedger(name: string): Ledger | null {
  const path = ledgerPath(name);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Ledger) : null;
}

export function saveLedger(name: string, ledger: Ledger) {
  const path = ledgerPath(name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(ledger, null, 1)}\n`);
}

// Haiku 4.5 list prices, USD per million tokens. Uncached, so this is a ceiling.
const RATES = { input: 1, output: 5 };

export function estimateLiveCost(calls: number, systemChars: number, avgMessageChars = 350, outputTokens = 110) {
  const inputTokens = calls * Math.ceil((systemChars + avgMessageChars) / 4);
  const output = calls * outputTokens;
  return { calls, inputTokens, outputTokens: output, usd: (inputTokens * RATES.input + output * RATES.output) / 1_000_000 };
}

/** "off": skipped. "plan": prints what would run and costs nothing. "run": calls the model, and only with an explicit yes. */
export function liveMode(env: Record<string, string | undefined> = process.env): "off" | "plan" | "run" {
  const value = env.LIVE_EVAL;
  if (!value) return "off";
  if (value === "plan") return "plan";
  return env.LIVE_EVAL_CONFIRM === "yes" ? "run" : "plan";
}

export function planText(name: string, total: number, pending: number, version: string, usd: number, mode: "plan" | "run" | "off") {
  const verified = total - pending;
  return [
    `${name} live eval: ${total} cases, ${verified} already verified for ${version}, ${pending} pending.`,
    pending ? `Estimated cost for the pending cases: about $${usd.toFixed(2)} (uncached, a ceiling).` : "Nothing to run.",
    mode === "run" ? "Running the pending cases now." : "Nothing was called. To run the pending cases: LIVE_EVAL_CONFIRM=yes npm run eval:live",
  ].join("\n");
}
