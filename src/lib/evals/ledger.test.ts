import { describe, expect, it } from "vitest";
import { caseHash, estimateLiveCost, liveMode, pendingCases, planText, recordVerified, type Ledger } from "./ledger";

type Item = { id: string; input: string; expect: string };
const items: Item[] = [{ id: "a", input: "one", expect: "x" }, { id: "b", input: "two", expect: "y" }, { id: "c", input: "three", expect: "z" }];
const idOf = (item: Item) => item.id;
const hashOf = (item: Item) => caseHash(item);

describe("only new or changed cases are pending (R21)", () => {
  it("everything is pending with no ledger, or for a new prompt version", () => {
    expect(pendingCases(items, null, "v1", idOf, hashOf)).toHaveLength(3);
    const ledger: Ledger = { version: "v1", verified: Object.fromEntries(items.map((item) => [item.id, hashOf(item)])) };
    expect(pendingCases(items, ledger, "v2", idOf, hashOf)).toHaveLength(3);
  });
  it("a verified case is skipped, an appended case is pending, and an edited case is pending again", () => {
    const ledger: Ledger = { version: "v1", verified: Object.fromEntries(items.map((item) => [item.id, hashOf(item)])) };
    expect(pendingCases(items, ledger, "v1", idOf, hashOf)).toEqual([]);
    const appended = [...items, { id: "d", input: "four", expect: "w" }];
    expect(pendingCases(appended, ledger, "v1", idOf, hashOf).map(idOf)).toEqual(["d"]);
    const edited = items.map((item) => (item.id === "b" ? { ...item, expect: "changed" } : item));
    expect(pendingCases(edited, ledger, "v1", idOf, hashOf).map(idOf)).toEqual(["b"]);
  });
  it("recording keeps earlier passes for the same version and starts fresh for a new one", () => {
    const first = recordVerified(null, "v1", [items[0]], idOf, hashOf);
    const second = recordVerified(first, "v1", [items[1]], idOf, hashOf);
    expect(Object.keys(second.verified)).toEqual(["a", "b"]);
    expect(Object.keys(recordVerified(second, "v2", [items[2]], idOf, hashOf).verified)).toEqual(["c"]);
  });
  it("a hash changes with any part of the case", () => {
    expect(caseHash({ a: 1 })).not.toBe(caseHash({ a: 2 }));
    expect(caseHash({ a: 1 })).toBe(caseHash({ a: 1 }));
  });
});

describe("nothing calls the model unless confirmed (R21)", () => {
  it("is off by default, and a run without the explicit yes is only a plan", () => {
    expect(liveMode({})).toBe("off");
    expect(liveMode({ LIVE_EVAL: "plan" })).toBe("plan");
    expect(liveMode({ LIVE_EVAL: "run" })).toBe("plan");
    expect(liveMode({ LIVE_EVAL: "run", LIVE_EVAL_CONFIRM: "no" })).toBe("plan");
    expect(liveMode({ LIVE_EVAL: "run", LIVE_EVAL_CONFIRM: "yes" })).toBe("run");
    expect(liveMode({ LIVE_EVAL: "plan", LIVE_EVAL_CONFIRM: "yes" })).toBe("plan");
  });
  it("estimates a ceiling from the pending count and the prompt size", () => {
    const none = estimateLiveCost(0, 10_000);
    expect(none.usd).toBe(0);
    const some = estimateLiveCost(100, 10_000);
    expect(some.calls).toBe(100);
    expect(some.usd).toBeGreaterThan(0.25);
    expect(some.usd).toBeLessThan(0.5);
    expect(estimateLiveCost(200, 10_000).usd).toBeCloseTo(some.usd * 2, 5);
  });
  it("says how many are verified, how many are pending, what it costs, and that nothing was called", () => {
    const text = planText("Router", 106, 6, "router-v6", 0.02, "plan");
    expect(text).toContain("106 cases, 100 already verified for router-v6, 6 pending");
    expect(text).toContain("about $0.02");
    expect(text).toContain("Nothing was called");
    expect(planText("Router", 106, 0, "router-v6", 0, "plan")).toContain("Nothing to run.");
  });
});
