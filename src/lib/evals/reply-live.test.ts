import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { REPLY_JSON_SCHEMA, REPLY_JUDGE_SYSTEM, REPLY_JUDGE_VERSION, judgeReply } from "@/lib/agents/reply-needed";
import { SpendMeter, capFromEnv, maxCasesFromEnv, runRefusal } from "./spend";
import { caseHash, estimateLiveCost, liveMode, loadLedger, pendingCases, planText, recordVerified, saveLedger } from "./ledger";
import { checkReply, loadReplyCases, type ReplyCase } from "./reply-check";

// R21: opt-in, incremental, metered. `npm run eval:cost` estimates without calling anything.
const mode = liveMode();
const cases = loadReplyCases();
const idOf = (item: ReplyCase) => item.id;
const hashOf = (item: ReplyCase) => caseHash(item);
const pending = mode === "off" ? [] : pendingCases(cases, loadLedger("reply"), REPLY_JUDGE_VERSION, idOf, hashOf);

describe.skipIf(mode === "off")("live: does this mail need a reply (R27, R21)", () => {
  it("plans the run", () => {
    console.log(planText("Reply", cases.length, pending.length, REPLY_JUDGE_VERSION, estimateLiveCost(pending.length, REPLY_JUDGE_SYSTEM.length, 700, 60, JSON.stringify(REPLY_JSON_SCHEMA).length).usd, mode));
  });

  it.skipIf(mode !== "run" || pending.length === 0)("judges every pending case as expected", async () => {
    const refusal = runRefusal(pending.length, capFromEnv(), maxCasesFromEnv());
    if (refusal) throw new Error(refusal); // nothing has been called
    const meter = new SpendMeter(capFromEnv()!);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 30_000 });
    const complete = async (params: Parameters<typeof client.messages.create>[0]) => { const message = await client.messages.create({ ...params, stream: false } as never) as unknown as { usage?: never }; meter.record(message.usage); return message as never; };
    const done: { item: ReplyCase; problems: string[] }[] = [];
    // The first call goes alone so the prompt cache is written once.
    for (let i = 0; i < pending.length;) {
      const size = i === 0 ? 1 : 8;
      if (!meter.canAfford(Math.min(size, pending.length - i))) break;
      const batch = pending.slice(i, i + size);
      done.push(...await Promise.all(batch.map(async (item) => ({ item, problems: checkReply(await judgeReply({ userId: "eval", messageId: item.id, from: item.from, subject: item.subject, text: item.text, sentAt: "2026-09-20T17:00:00.000Z" }, { complete: complete as never, cache: null }), item.expect) }))));
      i += batch.length;
    }
    console.log(meter.summary());
    const passed = done.filter((entry) => !entry.problems.length).map((entry) => entry.item);
    saveLedger("reply", recordVerified(loadLedger("reply"), REPLY_JUDGE_VERSION, passed, idOf, hashOf));
    const failed = done.filter((entry) => entry.problems.length).map((entry) => `${entry.item.id}: ${entry.item.subject}\n    ${entry.problems.join("\n    ")}`);
    console.log(`live eval: ${passed.length}/${done.length} cases run were correct; ledger updated`);
    if (done.length < pending.length) failed.push(`stopped at the spend limit: ${pending.length - done.length} of ${pending.length} cases were not run`);
    expect(failed, `\n${failed.join("\n")}\n`).toEqual([]);
  }, 600_000);
});
