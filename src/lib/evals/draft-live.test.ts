import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { DRAFT_JSON_SCHEMA, DRAFT_WRITER_SYSTEM, DRAFT_WRITER_VERSION, writeDraft } from "@/lib/drafts/writer";
import { SpendMeter, capFromEnv, maxCasesFromEnv, runRefusal } from "./spend";
import { caseHash, estimateLiveCost, liveMode, loadLedger, pendingCases, planText, recordVerified, saveLedger } from "./ledger";
import { checkDraft, loadDraftCases, type DraftCase } from "./draft-check";

// R21: opt-in, incremental, metered. `npm run eval:cost` estimates without calling anything.
const mode = liveMode();
const cases = loadDraftCases();
const idOf = (item: DraftCase) => item.id;
const hashOf = (item: DraftCase) => caseHash(item);
const pending = mode === "off" ? [] : pendingCases(cases, loadLedger("draft"), DRAFT_WRITER_VERSION, idOf, hashOf);

describe.skipIf(mode === "off")("live: the draft writer (R25, R21)", () => {
  it("plans the run", () => {
    console.log(planText("Draft", cases.length, pending.length, DRAFT_WRITER_VERSION, estimateLiveCost(pending.length, DRAFT_WRITER_SYSTEM.length, 900, 250, JSON.stringify(DRAFT_JSON_SCHEMA).length).usd, mode));
  });

  it.skipIf(mode !== "run" || pending.length === 0)("writes every pending case within its checks", async () => {
    const refusal = runRefusal(pending.length, capFromEnv(), maxCasesFromEnv());
    if (refusal) throw new Error(refusal); // nothing has been called
    const meter = new SpendMeter(capFromEnv()!);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 30_000 });
    const complete = async (params: Parameters<typeof client.messages.create>[0]) => { const message = await client.messages.create({ ...params, stream: false } as never) as unknown as { usage?: never }; meter.record(message.usage); return message as never; };
    const done: { item: DraftCase; problems: string[]; draft: unknown }[] = [];
    for (let i = 0; i < pending.length;) {
      const size = i === 0 ? 1 : 6;
      if (!meter.canAfford(Math.min(size, pending.length - i))) break;
      const batch = pending.slice(i, i + size);
      done.push(...await Promise.all(batch.map(async (item) => { const draft = await writeDraft(item.input, { complete: complete as never }); return { item, draft, problems: checkDraft(draft, item) }; })));
      i += batch.length;
    }
    console.log(meter.summary());
    const passed = done.filter((entry) => !entry.problems.length).map((entry) => entry.item);
    saveLedger("draft", recordVerified(loadLedger("draft"), DRAFT_WRITER_VERSION, passed, idOf, hashOf));
    const failed = done.filter((entry) => entry.problems.length).map((entry) => `${entry.item.id}\n    ${entry.problems.join("\n    ")}\n    draft: ${JSON.stringify(entry.draft).slice(0, 300)}`);
    console.log(`live eval: ${passed.length}/${done.length} cases run were correct; ledger updated`);
    if (done.length < pending.length) failed.push(`stopped at the spend limit: ${pending.length - done.length} of ${pending.length} cases were not run`);
    expect(failed, `\n${failed.join("\n")}\n`).toEqual([]);
  }, 600_000);
});
