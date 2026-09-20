import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { INTERPRETER_SYSTEM, INTERPRETER_VERSION, interpretEmail, type Interpretation } from "@/lib/agents/email-interpreter";
import { buildInterpreterCases, checkInterpretation, type InterpreterCase } from "./interpreter-cases";
import { SpendMeter, capFromEnv, maxCasesFromEnv, runRefusal } from "./spend";
import { caseHash, estimateLiveCost, liveMode, loadLedger, pendingCases, planText, recordVerified, saveLedger } from "./ledger";

// R21: opt-in and incremental. `npm run eval:cost` prints the plan and calls nothing.
// `LIVE_EVAL_CONFIRM=yes npm run eval:live` runs only the cases not yet verified for this prompt version.
const mode = liveMode();
const REPEAT = Number(process.env.LIVE_EVAL_REPEAT ?? 0);
const cases = buildInterpreterCases();
const idOf = (item: InterpreterCase) => item.label;
const hashOf = (item: InterpreterCase) => caseHash({ input: item.input, expect: item.expect });
const pending = mode === "off" ? [] : pendingCases(cases, loadLedger("interpreter"), INTERPRETER_VERSION, idOf, hashOf);

async function runAll(items: InterpreterCase[], complete: Parameters<typeof interpretEmail>[1]["complete"], meter: SpendMeter) {
  const results: Interpretation[] = [];
  for (let i = 0; i < items.length; i += 8) {
    // Stop before a batch that could pass the limit. The cases not reached stay pending.
    if (!meter.canAfford(Math.min(8, items.length - i))) break;
    results.push(...await Promise.all(items.slice(i, i + 8).map((item) => interpretEmail(item.input, { complete, cache: null }))));
  }
  return results;
}

describe.skipIf(mode === "off")("live: the email interpreter (R16.8, R21)", () => {
  it("plans the run", () => {
    console.log(planText("Interpreter", cases.length, pending.length, INTERPRETER_VERSION, estimateLiveCost(pending.length, INTERPRETER_SYSTEM.length).usd, mode));
  });

  it.skipIf(mode !== "run" || pending.length === 0)("resolves every pending case as expected", async () => {
    const refusal = runRefusal(pending.length, capFromEnv(), maxCasesFromEnv());
    if (refusal) throw new Error(refusal); // nothing has been called
    const meter = new SpendMeter(capFromEnv()!);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 30_000 });
    const complete = async (params: Parameters<typeof client.messages.create>[0]) => { const message = await client.messages.create({ ...params, stream: false } as never) as unknown as { usage?: never }; meter.record(message.usage); return message as never; };
    const results = await runAll(pending, complete as never, meter);
    console.log(meter.summary());
    const passed: InterpreterCase[] = [];
    const notRun = pending.length - results.length;
    const failed = pending.slice(0, results.length).flatMap((item, index) => {
      const problems = results[index].source === "rules" ? ["the model call failed, so the rules answered"] : checkInterpretation(results[index], item.expect);
      if (!problems.length) passed.push(item);
      return problems.length ? [`${item.label}\n    ${problems.join("\n    ")}`] : [];
    });
    saveLedger("interpreter", recordVerified(loadLedger("interpreter"), INTERPRETER_VERSION, passed, idOf, hashOf));
    console.log(`live eval: ${passed.length}/${results.length} cases run were correct; ledger updated${notRun ? `; ${notRun} case(s) were NOT run because the next batch could pass the limit` : ""}`);
    if (notRun) failed.push(`stopped at the spend limit: ${notRun} of ${pending.length} cases were not run`);
    expect(failed, `\n${failed.join("\n")}\n`).toEqual([]);
  }, 600_000);

  it.skipIf(mode !== "run" || REPEAT === 0)("gives identical answers when a sample is run again (only when asked for)", async () => {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 30_000 });
    const complete = (params: Parameters<typeof client.messages.create>[0]) => client.messages.create({ ...params, stream: false } as never) as never;
    const refusal = runRefusal(REPEAT * 2, capFromEnv(), maxCasesFromEnv());
    if (refusal) throw new Error(refusal);
    const meter = new SpendMeter(capFromEnv()!);
    const metered = async (params: Parameters<typeof client.messages.create>[0]) => { const message = await complete(params) as unknown as { usage?: never }; meter.record(message.usage); return message as never; };
    const sample = cases.slice(0, REPEAT);
    const [first, second] = [await runAll(sample, metered as never, meter), await runAll(sample, metered as never, meter)];
    const different = sample.flatMap((item, index) => (JSON.stringify({ ...first[index], reading: "", source: "" }) === JSON.stringify({ ...second[index], reading: "", source: "" }) ? [] : [item.label]));
    expect(different).toEqual([]);
  }, 600_000);
});
