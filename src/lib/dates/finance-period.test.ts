import { describe, expect, it } from "vitest";
import { resolveFinancePeriod } from "./finance-period";

describe("calendar periods versus rolling windows", () => {
 it.each([
  ["this week", "2026-09-28", "2026-09-28", "2026-09-21", "2026-09-21"],
  ["last week", "2026-09-21", "2026-09-27", "2026-09-14", "2026-09-20"],
  ["last 7 days", "2026-09-22", "2026-09-28", "2026-09-15", "2026-09-21"],
  ["this month", "2026-09-01", "2026-09-28", "2026-08-01", "2026-08-28"],
  ["last month", "2026-08-01", "2026-08-31", "2026-07-01", "2026-07-31"],
  ["this year", "2026-01-01", "2026-09-28", "2025-01-01", "2025-09-28"],
 ])("%s has matching calendar comparisons", (input,from,to,priorFrom,priorTo) => {
  expect(resolveFinancePeriod(`How much did I spend ${input}?`,"2026-09-28")).toMatchObject({range:{from,to},prior:{from:priorFrom,to:priorTo}});
 });
 it("compares a completed February to all of January",()=>{
  expect(resolveFinancePeriod("this month","2024-02-29")?.prior).toEqual({from:"2024-01-01",to:"2024-01-31"});
 });
 it("handles year boundaries and shorter prior months",()=>{
  expect(resolveFinancePeriod("this month","2026-03-30")?.prior).toEqual({from:"2026-02-01",to:"2026-02-28"});
  expect(resolveFinancePeriod("last week","2026-01-01")?.range).toEqual({from:"2025-12-22",to:"2025-12-28"});
 });
 it.each(["August this year","Monday this week","this week versus last week","Sep 1–7","since the 15th this month","this month in 2025","last 0 days"])("leaves qualified or ambiguous requests to the interpreter: %s",input=>{
  expect(resolveFinancePeriod(input,"2026-09-28")).toBeNull();
 });
});
