import { describe, expect, it } from "vitest";
import { answerPublicSearch, GENERAL_SEARCH_VERSION } from "@/lib/agents/general";
import { capFromEnv, maxCasesFromEnv, runRefusal } from "./spend";
import { caseHash, liveMode, loadLedger, pendingCases, planText, recordVerified, saveLedger } from "./ledger";
import { checkSearch, loadSearchCases, type SearchCase } from "./search-check";

// R42, R21: opt-in, incremental, metered by case count (not a SpendMeter -- answerPublicSearch has no injectable model client, unlike the
// trip planner, so per-call token cost isn't measured here; every call still goes through the app's own callClaude, which logs its real
// cost under "model_call" regardless). One real Tavily "advanced" search plus one real synthesis call per case; Tavily's own real,
// separate cost is not capped by this run either, same caveat as the trip planner's own live eval.
const mode = liveMode();
const cases = loadSearchCases();
const idOf = (item: SearchCase) => item.id;
const hashOf = (item: SearchCase) => caseHash(item);
const pending = mode === "off" ? [] : pendingCases(cases, loadLedger("search"), GENERAL_SEARCH_VERSION, idOf, hashOf);

describe.skipIf(mode === "off")("live: general web search finds the specific fact asked for (R42)", () => {
  it("plans the run", () => {
    console.log(planText("Search", cases.length, pending.length, GENERAL_SEARCH_VERSION, pending.length * 0.01, mode));
    console.log("Each case makes one real Tavily \"advanced\" search and one real synthesis call, at real, separate cost this run does not cap -- see each call's own \"model_call\" log line for measured token cost.");
  });

  it.skipIf(mode !== "run" || pending.length === 0)("answers with the specific fact for every pending case", async () => {
    const refusal = runRefusal(pending.length, capFromEnv(), maxCasesFromEnv());
    if (refusal) throw new Error(refusal);
    const done: { item: SearchCase; problems: string[] }[] = [];
    for (const item of pending) {
      try {
        const answer = await answerPublicSearch(item.query);
        done.push({ item, problems: checkSearch(answer, item.expect) });
      } catch (error) {
        done.push({ item, problems: [`threw instead of returning an answer: ${error instanceof Error ? error.message : String(error)}`] });
      }
    }
    const passed = done.filter((entry) => !entry.problems.length).map((entry) => entry.item);
    saveLedger("search", recordVerified(loadLedger("search"), GENERAL_SEARCH_VERSION, passed, idOf, hashOf));
    const failed = done.filter((entry) => entry.problems.length).map((entry) => `${entry.item.id}: "${entry.item.query}"\n    ${entry.problems.join("\n    ")}`);
    console.log(`live eval: ${passed.length}/${done.length} cases found the specific fact asked for; ledger updated`);
    expect(failed, `\n${failed.join("\n")}\n`).toEqual([]);
  }, 120_000);
});
