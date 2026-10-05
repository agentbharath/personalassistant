import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { EmailState } from "@/lib/conversations/email-state";
import { ROUTER_JSON_SCHEMA, ROUTER_SYSTEM, ROUTER_VERSION, routeMessage, type RouterDecision } from "@/lib/orchestrator/router";
import { checkDecision } from "./router-check";
import { parseRouterCases, routerEvalError, type RouterCase as Case } from "./router-cases";
import { SpendMeter, capFromEnv, maxCasesFromEnv, runRefusal } from "./spend";
import { caseHash, estimateLiveCost, liveMode, loadLedger, pendingCases, planText, recordVerified, saveLedger } from "./ledger";

// R21: opt-in and incremental. `npm run eval:cost` prints the plan and calls nothing.
// `LIVE_EVAL_CONFIRM=yes npm run eval:live` runs only the cases not yet verified for this prompt version.
const mode = liveMode();
const REPEAT = Number(process.env.LIVE_EVAL_REPEAT ?? 0);

const casePrefix = process.env.LIVE_EVAL_CASE_PREFIX;
const caseIds = process.env.LIVE_EVAL_CASE_IDS?.split(",").map(id => id.trim()).filter(Boolean);
const allCases = parseRouterCases(readFileSync(resolve(process.cwd(), "evals/router.jsonl"), "utf8"));
for (const id of caseIds ?? []) if (!allCases.some(item => item.id === id)) throw new Error(`Unknown router case ID: ${id}`);
const cases = allCases.filter(item => (!casePrefix || item.id.startsWith(casePrefix)) && (!caseIds || caseIds.includes(item.id)));
const idOf = (item: Case) => item.id;
const hashOf = (item: Case) => caseHash(item);
const pending = mode === "off" ? [] : pendingCases(cases, loadLedger("router"), ROUTER_VERSION, idOf, hashOf);

const toState = (state?: Case["state"]): EmailState | null => state ? {
  request: { action: state.action as never, topic: state.topic as never, sender: state.sender, days: 365, calendar: null, unread: false, humansOnly: false, exclusion: "" },
  results: Array.from({ length: state.results }, (_, index) => ({ id: `m${index}`, subject: `Order Confirmed #${index}`, from: "iHerb <noreply@info.iherb.com>", date: "" })),
  updatedAt: 1,
} : null;

async function runAll(items: Case[], complete: Parameters<typeof routeMessage>[1]["complete"], meter: SpendMeter, errors = new Map<string, string>()) {
  const out: Array<RouterDecision | null> = [];
  // The first call goes alone so the prompt cache is written once; the rest then read it instead of each paying to write it.
  for (let i = 0; i < items.length;) {
    const size = i === 0 ? 1 : 8;
    // Stop before a batch that could pass the limit. The cases not reached stay pending.
    if (!meter.canAfford(Math.min(size, items.length - i))) break;
    const batch = items.slice(i, i + size);
    out.push(...await Promise.all(batch.map((item) => routeMessage({ userId: "live-eval", message: item.input, context: item.context ?? [], emailState: toState(item.state), today: "2026-09-21", pendingApproval: item.pending ?? false, homeLocation: item.home ?? null, lastSearch: item.search ?? null }, { complete: async (params) => {
      try { return await complete(params); }
      catch (error) { errors.set(item.id, routerEvalError(error)); throw error; }
    }, cache: null }))));
    i += batch.length;
    // A provider rejection is not an intent miss. Preserve completed results and stop spending until diagnosed.
    if (batch.some(item => errors.has(item.id))) break;
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
    const errors = new Map<string, string>();
    const results = await runAll(pending, complete as never, meter, errors);
    console.log(meter.summary());
    const passed: Case[] = [];
    const notRun = pending.length - results.length;
    const failed = pending.slice(0, results.length).flatMap((item, index) => {
      const problems = errors.has(item.id) ? [`model request failed: ${errors.get(item.id)}`] : checkDecision(results[index], item.expect);
      if (!problems.length) passed.push(item);
      return problems.length ? [`${item.id}: ${item.input}\n    ${problems.join("\n    ")}`] : [];
    });
    saveLedger("router", recordVerified(loadLedger("router"), ROUTER_VERSION, passed, idOf, hashOf));
    console.log(`live eval: ${passed.length}/${results.length} cases run were correct; ledger updated${notRun ? `; ${notRun} case(s) were NOT run after a request failure or reaching the $${meter.capUsd.toFixed(2)} spend limit` : ""}`);
    if (notRun) failed.push(`stopped after a request failure or at the spend limit: ${notRun} of ${pending.length} cases were not run`);
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
