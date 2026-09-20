import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { EmailState } from "@/lib/conversations/email-state";
import { ROUTER_JSON_SCHEMA, ROUTER_SYSTEM, ROUTER_VERSION, routeMessage, type RouterDecision } from "@/lib/orchestrator/router";
import { checkDecision, type RouterExpect } from "./router-check";
import { SpendMeter, capFromEnv, maxCasesFromEnv, runRefusal } from "./spend";
import { caseHash, estimateLiveCost, liveMode, loadLedger, pendingCases, planText, recordVerified, saveLedger } from "./ledger";

// R21: opt-in and incremental. `npm run eval:cost` prints the plan and calls nothing.
// `LIVE_EVAL_CONFIRM=yes npm run eval:live` runs only the cases not yet verified for this prompt version.
const mode = liveMode();
const REPEAT = Number(process.env.LIVE_EVAL_REPEAT ?? 0);

type Case = { id: string; rule: string; input: string; pending?: boolean; home?: string; state?: { topic: string; sender: string; action: string; results: number }; context?: Array<{ role: "user" | "assistant"; content: string }>; expect: RouterExpect };
const cases = readFileSync(resolve(process.cwd(), "evals/router.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Case);
const idOf = (item: Case) => item.id;
const hashOf = (item: Case) => caseHash(item);
const pending = mode === "off" ? [] : pendingCases(cases, loadLedger("router"), ROUTER_VERSION, idOf, hashOf);

const toState = (state?: Case["state"]): EmailState | null => state ? {
  request: { action: state.action as never, topic: state.topic as never, sender: state.sender, days: 365, calendar: null, unread: false, humansOnly: false, exclusion: "" },
  results: Array.from({ length: state.results }, (_, index) => ({ id: `m${index}`, subject: `Order Confirmed #${index}`, from: "iHerb <noreply@info.iherb.com>", date: "" })),
  updatedAt: 1,
} : null;

async function runAll(items: Case[], complete: Parameters<typeof routeMessage>[1]["complete"], meter: SpendMeter) {
  const out: Array<RouterDecision | null> = [];
  // The first call goes alone so the prompt cache is written once; the rest then read it instead of each paying to write it.
  for (let i = 0; i < items.length;) {
    const size = i === 0 ? 1 : 8;
    // Stop before a batch that could pass the limit. The cases not reached stay pending.
    if (!meter.canAfford(Math.min(size, items.length - i))) break;
    const batch = items.slice(i, i + size);
    out.push(...await Promise.all(batch.map((item) => routeMessage({ userId: "live-eval", message: item.input, context: item.context ?? [], emailState: toState(item.state), today: "2026-09-21", pendingApproval: item.pending ?? false, homeLocation: item.home ?? null }, { complete, cache: null }))));
    i += batch.length;
  }
  return out;
}

describe.skipIf(mode === "off")("live: the router (R19.9, R21)", () => {
  it("plans the run", () => {
    console.log(planText("Router", cases.length, pending.length, ROUTER_VERSION, estimateLiveCost(pending.length, ROUTER_SYSTEM.length, 350, 300, JSON.stringify(ROUTER_JSON_SCHEMA).length).usd, mode));
  });

  it.skipIf(mode !== "run" || pending.length === 0)("routes every pending case to the expected operation", async () => {
    const refusal = runRefusal(pending.length, capFromEnv(), maxCasesFromEnv());
    if (refusal) throw new Error(refusal); // nothing has been called
    const meter = new SpendMeter(capFromEnv()!);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 30_000 });
    const complete = async (params: Parameters<typeof client.messages.create>[0]) => { const message = await client.messages.create({ ...params, stream: false } as never) as unknown as { usage?: never }; meter.record(message.usage); return message as never; };
    const results = await runAll(pending, complete as never, meter);
    console.log(meter.summary());
    const passed: Case[] = [];
    const notRun = pending.length - results.length;
    const failed = pending.slice(0, results.length).flatMap((item, index) => {
      const problems = checkDecision(results[index], item.expect);
      if (!problems.length) passed.push(item);
      return problems.length ? [`${item.id}: ${item.input}\n    ${problems.join("\n    ")}`] : [];
    });
    saveLedger("router", recordVerified(loadLedger("router"), ROUTER_VERSION, passed, idOf, hashOf));
    console.log(`live eval: ${passed.length}/${results.length} cases run were correct; ledger updated${notRun ? `; ${notRun} case(s) were NOT run because the next batch could pass the $${meter.capUsd.toFixed(2)} limit` : ""}`);
    if (notRun) failed.push(`stopped at the spend limit: ${notRun} of ${pending.length} cases were not run`);
    expect(failed, `\n${failed.join("\n")}\n`).toEqual([]);
  }, 600_000);

  it.skipIf(mode !== "run" || REPEAT === 0)("routes identically when a sample is run again (only when asked for)", async () => {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 30_000 });
    const complete = (params: Parameters<typeof client.messages.create>[0]) => client.messages.create({ ...params, stream: false } as never) as never;
    const refusal = runRefusal(REPEAT * 2, capFromEnv(), maxCasesFromEnv());
    if (refusal) throw new Error(refusal);
    const meter = new SpendMeter(capFromEnv()!);
    const metered = async (params: Parameters<typeof client.messages.create>[0]) => { const message = await complete(params) as unknown as { usage?: never }; meter.record(message.usage); return message as never; };
    const sample = cases.slice(0, REPEAT);
    const [first, second] = [await runAll(sample, metered as never, meter), await runAll(sample, metered as never, meter)];
    const different = sample.flatMap((item, index) => (JSON.stringify({ ...first[index], reading: "", source: "" }) === JSON.stringify({ ...second[index], reading: "", source: "" }) ? [] : [item.id]));
    expect(different).toEqual([]);
  }, 600_000);
});
