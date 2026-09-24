import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MEMORY_EXTRACTOR_JSON_SCHEMA, MEMORY_EXTRACTOR_SYSTEM, MEMORY_EXTRACTOR_VERSION, extractMemories } from "@/lib/memory/extractor";
import { checkMemoryCandidates, type MemoryExpect } from "./memory-check";
import { SpendMeter, capFromEnv, maxCasesFromEnv, runRefusal } from "./spend";
import { caseHash, estimateLiveCost, liveMode, loadLedger, pendingCases, planText, recordVerified, saveLedger } from "./ledger";

// R21, R.memory: opt-in, incremental, metered. `npm run eval:cost` prints the plan and calls nothing.
type ExistingRow = { id: string; type: "fact" | "preference" | "rule"; category: string; status: string; statement: string };
type Case = { id: string; message: string; existing: ExistingRow[]; expect: MemoryExpect };
const cases: Case[] = readFileSync(resolve(process.cwd(), "evals", "memory.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Case);
const mode = liveMode();
const idOf = (item: Case) => item.id;
const hashOf = (item: Case) => caseHash(item);
const pending = mode === "off" ? [] : pendingCases(cases, loadLedger("memory"), MEMORY_EXTRACTOR_VERSION, idOf, hashOf);

describe.skipIf(mode === "off")("live: the memory extractor (R.memory, R21)", () => {
  it("plans the run", () => {
    console.log(planText("Memory", cases.length, pending.length, MEMORY_EXTRACTOR_VERSION, estimateLiveCost(pending.length, MEMORY_EXTRACTOR_SYSTEM.length, 300, 200, JSON.stringify(MEMORY_EXTRACTOR_JSON_SCHEMA).length).usd, mode));
  });

  it.skipIf(mode !== "run" || pending.length === 0)("extracts (or correctly extracts nothing) for every pending scenario", async () => {
    const refusal = runRefusal(pending.length, capFromEnv(), maxCasesFromEnv());
    if (refusal) throw new Error(refusal); // nothing has been called
    const meter = new SpendMeter(capFromEnv()!);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 30_000 });
    const complete = async (params: Parameters<typeof client.messages.create>[0]) => { const message = await client.messages.create({ ...params, stream: false } as never) as unknown as { usage?: never }; meter.record(message.usage); return message as never; };
    const done: { item: Case; problems: string[] }[] = [];
    // The first call goes alone so the prompt cache is written once.
    for (let i = 0; i < pending.length;) {
      const size = i === 0 ? 1 : 8;
      if (!meter.canAfford(Math.min(size, pending.length - i))) break;
      const batch = pending.slice(i, i + size);
      done.push(...await Promise.all(batch.map(async (item) => ({ item, problems: checkMemoryCandidates(await extractMemories(item.message, item.existing as never, { complete: complete as never }), item.expect) }))));
      i += batch.length;
    }
    console.log(meter.summary());
    const passed = done.filter((entry) => !entry.problems.length).map((entry) => entry.item);
    saveLedger("memory", recordVerified(loadLedger("memory"), MEMORY_EXTRACTOR_VERSION, passed, idOf, hashOf));
    const failed = done.filter((entry) => entry.problems.length).map((entry) => `${entry.item.id}: ${entry.item.message}\n    ${entry.problems.join("\n    ")}`);
    console.log(`live eval: ${passed.length}/${done.length} cases run were correct; ledger updated`);
    if (done.length < pending.length) failed.push(`stopped at the spend limit: ${pending.length - done.length} of ${pending.length} cases were not run`);
    expect(failed, `\n${failed.join("\n")}\n`).toEqual([]);
  }, 600_000);
});
