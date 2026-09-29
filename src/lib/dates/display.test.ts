import { describe, expect, it } from "vitest";
import { compactDateLabel, formatDateRange } from "./display";

describe("date-only range labels", () => {
  it.each([
    ["2026-09-01", "2026-09-28", "Sep 1–28, 2026"],
    ["2026-09-28", "2026-09-28", "Sep 28, 2026"],
    ["2026-09-28", "2026-10-13", "Sep 28 – Oct 13, 2026"],
    ["2025-12-28", "2026-01-03", "Dec 28, 2025 – Jan 3, 2026"],
    ["2024-02-28", "2024-02-29", "Feb 28–29, 2024"],
  ])("formats %s through %s without duplicated months or lost years", (from, to, expected) => {
    expect(formatDateRange(from, to)).toBe(expected);
  });
  it("supports earlier ISO and verbose card labels without parsing arbitrary prose", () => {
    expect(compactDateLabel("2026-09-01–2026-09-28")).toBe("Sep 1–28, 2026");
    expect(compactDateLabel("Sep 1, 2026 – Sep 28, 2026")).toBe("Sep 1–28, 2026");
    expect(compactDateLabel("Last week")).toBe("Last week");
    expect(compactDateLabel("2026-02-30–2026-03-01")).toBe("2026-02-30–2026-03-01");
  });
});
