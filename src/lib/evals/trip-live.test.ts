import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { TRIP_PLANNER_VERSION, runTripPlan, type TripPlannerDeps } from "@/lib/agents/trip-planner";
import { configuredModel } from "@/lib/runtime/query-budget";
import { SpendMeter, capFromEnv, maxCasesFromEnv, runRefusal } from "./spend";
import { caseHash, liveMode, loadLedger, pendingCases, planText, recordVerified, saveLedger } from "./ledger";
import { checkTrip, loadTripCases, type TripCase } from "./trip-check";

// R21: opt-in, incremental, metered. `npm run eval:cost` estimates without calling anything.
const mode = liveMode();
const cases = loadTripCases();
const idOf = (item: TripCase) => item.id;
const hashOf = (item: TripCase) => caseHash(item);
const pending = mode === "off" ? [] : pendingCases(cases, loadLedger("trip"), TRIP_PLANNER_VERSION, idOf, hashOf);

/** `estimateLiveCost` in ledger.ts assumes one call at Haiku's rate; a plan is a genuinely different shape — one Haiku extraction call plus
 * one or two calls at whatever `"high"` currently means (Opus today), so it needs its own estimate, not the shared one, or the printed
 * number would be badly wrong for exactly the reason this eval exists (a stronger composer really does cost more). */
function tripRates(model: string) {
  if (/opus/i.test(model)) return { input: 15, output: 75 };
  if (/sonnet/i.test(model)) return { input: 3, output: 15 };
  return { input: 1, output: 5 };
}
function estimateTripLiveCost(pendingCount: number) {
  const extraction = (6000 * 1 + 2200 * 5) / 1_000_000; // ~20 sources of evidence in, Haiku
  const composerRate = tripRates(configuredModel("high"));
  const oneComposition = (2000 * composerRate.input + 2400 * composerRate.output) / 1_000_000;
  return pendingCount * (extraction + oneComposition * 1.5); // most cases need at most one repair pass
}

describe.skipIf(mode === "off")("live: the trip planner, end to end (R32, R21)", () => {
  it("plans the run", () => {
    console.log(planText("Trip", cases.length, pending.length, TRIP_PLANNER_VERSION, estimateTripLiveCost(pending.length), mode));
    console.log(`Composer model today: ${configuredModel("high")}. Each case also makes 4 real Tavily "advanced" searches and one time-interpretation call — neither is metered by this run's dollar limit (only the two calls this eval wires to a spend-metered client are); Tavily in particular is real, separate cost this run does not cap.`);
  });

  it.skipIf(mode !== "run" || pending.length === 0)("produces a real day-by-day plan, on real research, for every pending case", async () => {
    const refusal = runRefusal(pending.length, capFromEnv(), maxCasesFromEnv());
    if (refusal) throw new Error(refusal); // nothing has been called
    const meter = new SpendMeter(capFromEnv()!);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
    const complete: TripPlannerDeps["complete"] = async (_operation, params) => {
      const message = await client.messages.create({ ...params, stream: false } as never) as unknown as { usage?: never };
      meter.record(message.usage);
      return message as never;
    };
    const done: { item: TripCase; problems: string[] }[] = [];
    // Sequential, not batched: each case is already 4 parallel Tavily calls plus up to 3 model calls, a much heavier unit of work than
    // this framework's other per-call checks, and spend is checked before every single one, not every batch of 8.
    for (const item of pending) {
      if (!meter.canAfford(1, 0.15)) break; // a trip case costs far more per call than the framework's 0.01 default assumption
      try {
        const answer = await runTripPlan(item.destination, item.dateText, "eval", [], { complete });
        done.push({ item, problems: checkTrip(answer, item.expect) });
      } catch (error) {
        // The pipeline itself degrades a bad model response to a plain message rather than throwing (see trip-planner.ts); this only
        // catches something else going wrong (a network error, a genuine bug), so one case never silences the measured spend on the rest.
        done.push({ item, problems: [`threw instead of returning an answer: ${error instanceof Error ? error.message : String(error)}`] });
      }
    }
    console.log(meter.summary());
    const passed = done.filter((entry) => !entry.problems.length).map((entry) => entry.item);
    saveLedger("trip", recordVerified(loadLedger("trip"), TRIP_PLANNER_VERSION, passed, idOf, hashOf));
    const failed = done.filter((entry) => entry.problems.length).map((entry) => `${entry.item.id}: ${entry.item.destination}, ${entry.item.dateText}\n    ${entry.problems.join("\n    ")}`);
    console.log(`live eval: ${passed.length}/${done.length} cases run were correct; ledger updated`);
    if (done.length < pending.length) failed.push(`stopped at the spend limit: ${pending.length - done.length} of ${pending.length} cases were not run`);
    expect(failed, `\n${failed.join("\n")}\n`).toEqual([]);
  }, 600_000);
});
