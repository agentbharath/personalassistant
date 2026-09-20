import { describe, expect, it } from "vitest";
import { isPublicCacheEligible, normalizePublicQuery } from "./public-query-cache";

describe("PII-safe public query caching", () => {
  it("normalizes equivalent public searches", () => {
    expect(normalizePublicQuery("  Best   Chinese Restaurants IN Dallas ")).toBe("best chinese restaurants in dallas");
  });

  it("allows non-personal public discovery", () => {
    expect(isPublicCacheEligible("best Chinese restaurants in Sunnyvale, CA")).toBe(true);
    expect(isPublicCacheEligible("Anirudh concert dates in Dallas")).toBe(true);
  });

  it.each([
    "restaurants near me",
    "coffee near my home",
    "events near 123 Main Street",
    "find events and email me at person@example.com",
    "find my bill account 12345678",
  ])("bypasses shared cache for personal query: %s", (query) => {
    expect(isPublicCacheEligible(query)).toBe(false);
  });
});
