import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { TIME_INTERPRETER_VERSION, TIME_SYSTEM, TIME_JSON_SCHEMA, interpretTime } from "@/lib/agents/time-interpreter";
import { SpendMeter, capFromEnv, maxCasesFromEnv, runRefusal } from "./spend";
import { caseHash, estimateLiveCost, liveMode, loadLedger, pendingCases, planText, recordVerified, saveLedger } from "./ledger";
import { checkTime, loadTimeCases, type TimeCase } from "./time-check";

// R21: opt-in, incremental, metered. `npm run eval:cost` estimates without calling anything.
const mode = liveMode();
const cases = loadTimeCases();
const idOf = (item: TimeCase) => item.id;
const hashOf = (item: TimeCase) => caseHash({ input: item.input, today: item.today, context: item.context, expect: item.expect });
const pending = mode === "off" ? [] : pendingCases(cases, loadLedger("time"), TIME_INTERPRETER_VERSION, idOf, hashOf);

describe.skipIf(mode === "off")("live: the time interpreter (R20.5, R21)", () => {
  it("plans the run", () => {
    console.log(planText("Time", cases.length, pending.length, TIME_INTERPRETER_VERSION, estimateLiveCost(pending.length, TIME_SYSTEM.length, 250, 120, JSON.stringify(TIME_JSON_SCHEMA).length).usd, mode));
  });

  it.skipIf(mode !== "run" || pending.length === 0)("reads every pending case as expected", async () => {
    const refusal = runRefusal(pending.length, capFromEnv(), maxCasesFromEnv());
    if (refusal) throw new Error(refusal); // nothing has been called
    const meter = new SpendMeter(capFromEnv()!);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 30_000 });
    const complete = async (params: Parameters<typeof client.messages.create>[0]) => { const message = await client.messages.create({ ...params, stream: false } as never) as unknown as { usage?: never }; meter.record(message.usage); return message as never; };
    const done: { item: TimeCase; problems: string[] }[] = [];
    for (let i = 0; i < pending.length; i += 8) {
      if (!meter.canAfford(Math.min(8, pending.length - i))) break;
      done.push(...await Promise.all(pending.slice(i, i + 8).map(async (item) => ({ item, problems: checkTime(await interpretTime({ message: item.input, today: item.today, timeZone: "America/Los_Angeles", userId: "eval", context: item.context }, { complete: complete as never, cache: null }), item.expect) }))));
    }
    console.log(meter.summary());
    const passed = done.filter((entry) => !entry.problems.length).map((entry) => entry.item);
    saveLedger("time", recordVerified(loadLedger("time"), TIME_INTERPRETER_VERSION, passed, idOf, hashOf));
    const failed = done.filter((entry) => entry.problems.length).map((entry) => `${entry.item.id}: ${entry.item.input}\n    ${entry.problems.join("\n    ")}`);
    console.log(`live eval: ${passed.length}/${done.length} cases run were correct; ledger updated`);
    if (done.length < pending.length) failed.push(`stopped at the spend limit: ${pending.length - done.length} of ${pending.length} cases were not run`);
    expect(failed, `\n${failed.join("\n")}\n`).toEqual([]);
  }, 600_000);
});
