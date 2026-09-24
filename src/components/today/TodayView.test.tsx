import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { billBuckets } from "@/lib/today/brief";
import { TodayView } from "./TodayView";

const today = "2026-09-21";
const bill = (id: string, dueDate: string | null, amountMinor = 1000, currency = "USD") => ({ id, merchant: id, dueDate, amountMinor, currency, category: "utilities", statementDate: "2026-09-01", status: "outstanding" as const, paidOn: null });

describe("all dues in reminders", () => {
  it("shows later and undated bills and includes every group in per-currency totals", () => {
    const html = renderToStaticMarkup(<TodayView view={{ today, meetingsToday: { state: "ok", value: [] }, meetingsAhead: { state: "ok", value: [] }, spending: { state: "ok", value: null }, bills: { state: "ok", value: billBuckets([bill("Late Utility", "2026-09-15"), bill("Next Month", "2026-10-15", 2000), bill("Undated", null, 3000), bill("Euro bill", null, 4000, "EUR")], today) } }} />);
    for (const text of ["Reminders", "All dues", "Late Utility", "Next Month", "Undated", "Due later", "No due date", "$60.00", "€40.00", "4 outstanding", "Find statements in email"]) expect(html).toContain(text);
    expect(html).not.toContain("No unpaid bills");
  });
});
