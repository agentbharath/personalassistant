import { describe, expect, it, vi } from "vitest";
import { extractSportsSlots } from "./sports-query";

const reply = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] }) as never;
const complete = (value: unknown) => vi.fn().mockResolvedValue(reply(value));

describe("sports slot extraction (R47)", () => {
  it("resolves a single named team to ESPN's own sport/league/team path", async () => {
    const outcome = await extractSportsSlots("what was the score of the niners game", complete({ resolved: true, sport: "football", league: "nfl", team: "SF" }));
    expect(outcome).toEqual({ kind: "slots", slots: { sport: "football", league: "nfl", team: "sf" } });
  });

  it("resolves a cricket national team with no league slug needed, unlike every other sport here", async () => {
    const outcome = await extractSportsSlots("did India win", complete({ resolved: true, sport: "cricket", league: "", team: "India" }));
    expect(outcome).toEqual({ kind: "slots", slots: { sport: "cricket", league: "", team: "india" } });
  });

  it("stays unresolved for a whole-league question, never forcing a single-team answer onto it", async () => {
    const outcome = await extractSportsSlots("what were last night's NBA scores", complete({ resolved: false, sport: "", league: "", team: "" }));
    expect(outcome).toEqual({ kind: "unresolved" });
  });

  it("stays unresolved when the model can't confidently place the team, rather than guessing", async () => {
    const outcome = await extractSportsSlots("how'd my team do", complete({ resolved: false, sport: "", league: "", team: "" }));
    expect(outcome).toEqual({ kind: "unresolved" });
  });

  it("degrades to unavailable, never a crash, on a malformed or missing model response", async () => {
    const malformed = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "{\"resolved\": not valid json" }] });
    expect(await extractSportsSlots("x", malformed)).toEqual({ kind: "unavailable" });
    expect(await extractSportsSlots("x", vi.fn().mockResolvedValue({ content: [] }))).toEqual({ kind: "unavailable" });
  });
});
