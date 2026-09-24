import { describe, expect, it } from "vitest";
import { BILLS_EMAIL_RECHECK_MS, dueForBillsEmailCheck } from "./sync-state";

describe("when a bills email sweep is due (R17.8, free)", () => {
  it("is due when never checked", () => {
    expect(dueForBillsEmailCheck(null, new Date())).toBe(true);
  });
  it("is not due right after a check", () => {
    const now = new Date("2026-09-20T12:00:00Z");
    expect(dueForBillsEmailCheck(new Date("2026-09-20T09:00:00Z"), now)).toBe(false);
  });
  it("is due once the interval has passed", () => {
    const now = new Date("2026-09-20T12:00:00Z");
    expect(dueForBillsEmailCheck(new Date(now.getTime() - BILLS_EMAIL_RECHECK_MS), now)).toBe(true);
    expect(dueForBillsEmailCheck(new Date(now.getTime() - BILLS_EMAIL_RECHECK_MS + 1000), now)).toBe(false);
  });
});
