import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { INTERPRETER_SYSTEM, INTERPRETER_VERSION, interpretEmail, type Interpretation } from "@/lib/agents/email-interpreter";
import { buildInterpreterCases, checkInterpretation, type InterpreterCase } from "./interpreter-cases";
import { caseHash, estimateLiveCost, liveMode, loadLedger, pendingCases, planText, recordVerified, saveLedger } from "./ledger";

// R21: opt-in and incremental. `npm run eval:cost` prints the plan and calls nothing.
// `LIVE_EVAL_CONFIRM=yes npm run eval:live` runs only the cases not yet verified for this prompt version.
const mode = liveMode();
const REPEAT = Number(process.env.LIVE_EVAL_REPEAT ?? 0);
const cases = buildInterpreterCases();
const idOf = (item: InterpreterCase) => item.label;
const hashOf = (item: InterpreterCase) => caseHash({ input: item.input, expect: item.expect });
const pending = mode === "off" ? [] : pendingCases(cases, loadLedger("interpreter"), INTERPRETER_VERSION, idOf, hashOf);

async function runAll(items: InterpreterCase[], complete: Parameters<typeof interpretEmail>[1]["complete"]) {
  const results: Interpretation[] = [];
  for (let i = 0; i < items.length; i += 8) {
    results.push(...await Promise.all(items.slice(i, i + 8).map((item) => interpretEmail(item.input, { complete, cache: null }))));
  }
  return results;
}

describe.skipIf(mode === "off")("live: the email interpreter (R16.8, R21)", () => {
  it("plans the run", () => {
    console.log(planText("Interpreter", cases.length, pending.length, INTERPRETER_VERSION, estimateLiveCost(pending.length, INTERPRETER_SYSTEM.length).usd, mode));
  });

  it.skipIf(mode !== "run" || pending.length === 0)("resolves every pending case as expected", async () => {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 30_000 });
    const complete = (params: Parameters<typeof client.messages.create>[0]) => client.messages.create({ ...params, stream: false } as never) as never;
    const results = await runAll(pending, complete as never);
    const passed: InterpreterCase[] = [];
    const failed = pending.flatMap((item, index) => {
      const problems = results[index].source === "rules" ? ["the model call failed, so the rules answered"] : checkInterpretation(results[index], item.expect);
      if (!problems.length) passed.push(item);
      return problems.length ? [`${item.label}\n    ${problems.join("\n    ")}`] : [];
    });
    saveLedger("interpreter", recordVerified(loadLedger("interpreter"), INTERPRETER_VERSION, passed, idOf, hashOf));
    console.log(`live eval: ${passed.length}/${pending.length} pending cases correct; ledger updated`);
    expect(failed, `\n${failed.join("\n")}\n`).toEqual([]);
  }, 600_000);

  it.skipIf(mode !== "run" || REPEAT === 0)("gives identical answers when a sample is run again (only when asked for)", async () => {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 30_000 });
    const complete = (params: Parameters<typeof client.messages.create>[0]) => client.messages.create({ ...params, stream: false } as never) as never;
    const sample = cases.slice(0, REPEAT);
    const [first, second] = [await runAll(sample, complete as never), await runAll(sample, complete as never)];
    const different = sample.flatMap((item, index) => (JSON.stringify({ ...first[index], reading: "", source: "" }) === JSON.stringify({ ...second[index], reading: "", source: "" }) ? [] : [item.label]));
    expect(different).toEqual([]);
  }, 600_000);
});
