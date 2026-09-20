import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { DateClarificationError, getCalendarWindow } from "@/lib/agents/calendar";

const zone = "America/Los_Angeles";
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

describe("missing-year date policy evaluation", () => {
  it("uses the current year when the yearless date has not passed", () => {
    const now = Temporal.Now.zonedDateTimeISO(zone);
    const future = now.toPlainDate().add({ days: Math.min(20, now.daysInMonth - now.day) });
    const input = `${months[future.month - 1]} ${future.day}`;
    expect(getCalendarWindow(input, zone).start.year).toBe(now.year);
  });

  it("asks for the year only when the yearless date is in the past", () => {
    const now = Temporal.Now.zonedDateTimeISO(zone);
    if (now.day === 1 && now.month === 1) return;
    const past = now.toPlainDate().subtract({ days: 1 });
    expect(() => getCalendarWindow(`${months[past.month - 1]} ${past.day}`, zone)).toThrow(DateClarificationError);
  });
});
