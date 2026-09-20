import { describe, expect, it } from "vitest";
import { MIN_AWAY_MS, shouldRefreshOnReturn } from "./refresh-policy";

describe("when Perch refreshes on returning to the tab (free)", () => {
  it("does not refresh if the tab was never hidden", () => {
    expect(shouldRefreshOnReturn(null, 1_000_000)).toBe(false);
  });
  it("does not refresh after a quick tab flip", () => {
    expect(shouldRefreshOnReturn(1_000_000, 1_000_000 + MIN_AWAY_MS - 1)).toBe(false);
  });
  it("refreshes after a minute or more away", () => {
    expect(shouldRefreshOnReturn(1_000_000, 1_000_000 + MIN_AWAY_MS)).toBe(true);
    expect(shouldRefreshOnReturn(1_000_000, 1_000_000 + 10 * 60_000)).toBe(true);
  });
});
