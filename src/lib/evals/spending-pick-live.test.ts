import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SPENDING_PICKER_SCHEMA, SPENDING_PICKER_SYSTEM, SPENDING_PICKER_VERSION, pickSpendingEmails, type PickableEmail } from "@/lib/agents/spending-picker";
import { SpendMeter, capFromEnv, maxCasesFromEnv, runRefusal } from "./spend";
import { caseHash, estimateLiveCost, liveMode, loadLedger, pendingCases, planText, recordVerified, saveLedger } from "./ledger";

// R21: opt-in, incremental, metered. The whole set goes in one list, as a real sweep would, so the model sees the mix it will see in a mailbox.
type Case = PickableEmail & { expect: { spending: boolean } };
const cases: Case[] = readFileSync(resolve(process.cwd(), "evals", "spending-pick.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Case);
const mode = liveMode();
const idOf = (item: Case) => item.id;
const hashOf = (item: Case) => caseHash(item);
const pending = mode === "off" ? [] : pendingCases(cases, loadLedger("spending-pick"), SPENDING_PICKER_VERSION, idOf, hashOf);

describe.skipIf(mode === "off")("live: which emails record spending (R20.5, R21)", () => {
  it("plans the run", () => {
    console.log(planText("Spending picker", cases.length, pending.length, SPENDING_PICKER_VERSION, estimateLiveCost(pending.length ? 1 : 0, SPENDING_PICKER_SYSTEM.length, pending.length * 260, 60, JSON.stringify(SPENDING_PICKER_SCHEMA).length).usd, mode));
  });

  it.skipIf(mode !== "run" || pending.length === 0)("picks every purchase and nothing else", async () => {
    const refusal = runRefusal(1, capFromEnv(), maxCasesFromEnv());
    if (refusal) throw new Error(refusal);
    const meter = new SpendMeter(capFromEnv()!);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
    const complete = async (params: Parameters<typeof client.messages.create>[0]) => { const message = await client.messages.create({ ...params, stream: false } as never) as unknown as { usage?: never }; meter.record(message.usage); return message as never; };
    const result = await pickSpendingEmails("eval", pending, { complete: complete as never, cache: null });
    console.log(meter.summary());
    expect(result.unavailable).toBe(false);
    const chosen = new Set(result.ids);
    const passed = pending.filter((item) => chosen.has(item.id) === item.expect.spending);
    const failed = pending.filter((item) => chosen.has(item.id) !== item.expect.spending).map((item) => `${item.id}: ${item.subject}\n    wanted ${item.expect.spending ? "picked" : "not picked"}, got the opposite`);
    saveLedger("spending-pick", recordVerified(loadLedger("spending-pick"), SPENDING_PICKER_VERSION, passed, idOf, hashOf));
    console.log(`live eval: ${passed.length}/${pending.length} cases correct; ledger updated`);
    expect(failed, `\n${failed.join("\n")}\n`).toEqual([]);
  }, 300_000);
});
