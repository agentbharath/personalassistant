import { describe, expect, it } from "vitest";
import { groundCitedNumbers } from "./claim-grounding";

const evidence = (...snippets: string[]) => snippets.map((snippet) => ({ snippet }));

describe("a cited number should actually be in the source it cites (free)", () => {
  it("keeps a citation whose number really is in its source", () => {
    const answer = "The Eiffel Tower opened in 1889 [1]. It stands 1,083 feet tall [2].";
    const out = groundCitedNumbers(answer, evidence("Completed in 1889, the tower was the tallest structure in the world.", "The tower is 1,083 feet (330 m) tall including antennas."));
    expect(out).toBe(answer);
  });

  it("tolerates a rounding/precision difference instead of flagging it", () => {
    const answer = "Mount Everest is 29,032 feet tall [1].";
    const out = groundCitedNumbers(answer, evidence("The official height, jointly announced in 2020, is 29,031.7 feet."));
    expect(out).toBe(answer);
  });

  it("strips the citation, but keeps the sentence, when the source doesn't actually contain the cited number", () => {
    const answer = "The starting price is $38,630 [1]. It comes in three trims [2].";
    const out = groundCitedNumbers(answer, evidence("This SUV is a great family vehicle with plenty of cargo space.", "Available in three trims: base, sport, and premium."));
    expect(out).toBe("The starting price is $38,630. It comes in three trims [2].");
  });

  it("leaves an uncited sentence alone, whatever numbers it states", () => {
    const answer = "Prices vary widely across dealers, sometimes by $2,000 or more.";
    expect(groundCitedNumbers(answer, evidence("unrelated evidence"))).toBe(answer);
  });

  it("is satisfied when any one of several citations on the same sentence backs the number", () => {
    const answer = "The phone has a 5,088 mAh battery [1][2].";
    const out = groundCitedNumbers(answer, evidence("Reviewers praised the camera and display quality.", "Battery capacity comes in at 5,088 mAh for the eSIM model."));
    expect(out).toBe(answer);
  });

  it("never touches a citation whose sentence states no number at all", () => {
    const answer = "It's widely considered the best in its class [1].";
    expect(groundCitedNumbers(answer, evidence("completely unrelated text"))).toBe(answer);
  });
});
