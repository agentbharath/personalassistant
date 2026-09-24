import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { autopayDue, classifyDocument, extractDueDate, matchPayment, outstandingNote, parseBillsCommand, parseLooseDate, pastDue, renderBills, sameMerchant, type Bill } from "./bills";

const load = <T,>(name: string) => readFileSync(resolve(process.cwd(), "evals", name), "utf8").trim().split("\n").map((line) => JSON.parse(line) as T);

describe("document kinds (evals/bills-classify.jsonl)", () => {
  for (const { id, rule, subject, expect: want } of load<{ id: string; rule: string; subject: string; expect: string }>("bills-classify.jsonl")) {
    it(`${id} [${rule}]`, () => expect(classifyDocument(subject)).toBe(want));
  }
});

describe("bill commands (evals/bills-commands.jsonl)", () => {
  for (const { id, rule, input, expect: want } of load<{ id: string; rule: string; input: string; expect: unknown }>("bills-commands.jsonl")) {
    it(`${id} [${rule}]`, () => expect(parseBillsCommand(input, "2026-09-20")).toEqual(want));
  }
});

describe("dates in emails (R17.2)", () => {
  it.each([
    ["Oct 5, 2026", "2026-09-17", "2026-10-05"], ["October 5, 2026", "2026-09-17", "2026-10-05"], ["10/05/2026", "2026-09-17", "2026-10-05"], ["2026-10-05", "2026-09-17", "2026-10-05"],
    ["Nov 3", "2026-09-17", "2026-11-03"], ["Dec 31st", "2026-09-17", "2026-12-31"], ["Jan 4", "2026-12-20", "2027-01-04"], ["Sep 30", "2026-09-17", "2026-09-30"],
  ])("%s (statement %s) → %s", (value, reference, iso) => expect(parseLooseDate(value, reference)).toBe(iso));
  it("reads the due date from the wording a bill uses", () => {
    expect(extractDueDate("Your bill is $146.30. Payment due: Oct 5, 2026. Pay online.", "2026-09-17")).toBe("2026-10-05");
    expect(extractDueDate("Amount due $89.00 due date 10/12/2026", "2026-09-17")).toBe("2026-10-12");
    expect(extractDueDate("Please pay by Nov 3", "2026-09-17")).toBe("2026-11-03");
    expect(extractDueDate("Your statement is ready. Thanks for being a customer.", "2026-09-17")).toBeNull();
  });
});

const bill = (over: Partial<Bill> = {}): Bill => ({ id: "b1", merchant: "PG&E", amountMinor: 14630, currency: "USD", category: "utilities", statementDate: "2026-09-17", dueDate: "2026-10-05", status: "outstanding", paidOn: null, ...over });

describe("a payment settles a bill (R17.4)", () => {
  const payment = { currency: "USD", merchant: "Pacific Gas and Electric", amountMinor: 14630, date: "2026-09-25" };
  it("matches the same merchant, a matching amount, after the statement", () => {
    expect(matchPayment([bill()], { ...payment, merchant: "PG&E" })?.id).toBe("b1");
    expect(matchPayment([bill()], { ...payment, amountMinor: 14700 })).toBeNull();
  });
  it.each([
    ["a different amount", { ...payment, merchant: "PG&E", amountMinor: 9900 }],
    ["a different merchant", { ...payment, merchant: "Comcast" }],
    ["a payment dated before the statement", { ...payment, merchant: "PG&E", date: "2026-09-01" }],
  ])("does not match %s", (_name, pay) => expect(matchPayment([bill()], pay)).toBeNull());
  it("ignores a bill that is already paid, and requires the exact amount", () => {
    expect(matchPayment([bill({ status: "paid" })], { ...payment, merchant: "PG&E" })).toBeNull();
    expect(matchPayment([bill({ id: "far", amountMinor: 14700 }), bill({ id: "near", amountMinor: 14630 })], { ...payment, merchant: "PG&E" })?.id).toBe("near");
  });
  it("knows PG&E is Pacific Gas and Electric, and that unrelated names differ", () => {
    expect(sameMerchant("PG&E", "PG&E Energy")).toBe(true);
    expect(sameMerchant("Xfinity", "Comcast")).toBe(false);
  });
});

describe("autopay and past due (R17.6, R17.7)", () => {
  it("autopay bills settle on their due date, and only those", () => {
    const bills = [bill({ id: "a", dueDate: "2026-09-30" }), bill({ id: "b", dueDate: "2026-10-30" }), bill({ id: "c", merchant: "Xfinity", dueDate: "2026-09-01" }), bill({ id: "d", dueDate: null })];
    expect(autopayDue(bills, ["pg&e"], "2026-10-05").map((item) => item.id)).toEqual(["a"]);
  });
  it("lists outstanding bills past their due date", () => {
    expect(pastDue([bill({ dueDate: "2026-09-01" }), bill({ id: "x", dueDate: "2026-11-01" }), bill({ id: "y", dueDate: null })], "2026-09-20").map((item) => item.id)).toEqual(["b1"]);
  });
});

describe("what the user sees (R17.3, R17.7, R17.8)", () => {
  it("adds one line to spending when bills are outstanding, and nothing when none are", () => {
    expect(outstandingNote([bill()], "2026-09-20")).toBe("Not counted yet: 1 unpaid bill, $146.30 (PG&E, due Oct 5, 2026).");
    expect(outstandingNote([bill({ status: "paid" })], "2026-09-20")).toBe("");
  });
  it("lists past due first with the question, and a payment it found", () => {
    const late = bill({ id: "late", merchant: "Xfinity", amountMinor: 8900, dueDate: "2026-09-10" });
    const text = renderBills([bill(), late], "2026-09-20", [{ billId: "b1", date: "2026-09-19", amountMinor: 14630 }]);
    expect(text.indexOf("Past due")).toBeLessThan(text.indexOf("Upcoming"));
    expect(text).toContain("Did you pay it? Say “I paid the Xfinity bill”.");
    expect(text).toContain("I found a payment email for $146.30 on Sep 19, 2026");
    expect(text).toContain("Total outstanding: $235.30");
    expect(text).toContain("aren't counted as spending until they're paid");
  });
  it("says so when nothing is outstanding", () => {
    expect(renderBills([], "2026-09-20")).toMatch(/No outstanding bills/);
  });
});

it("requires matching currency, account and a unique bill", () => {
  const payment = { merchant: "PG&E", amountMinor: 14630, date: "2026-09-25", currency: "USD", accountLastFour: "1234" };
  expect(matchPayment([bill({ currency: "INR", accountLastFour: "1234" })], payment)).toBeNull();
  expect(matchPayment([bill({ accountLastFour: "5678" })], payment)).toBeNull();
  expect(matchPayment([bill({ accountLastFour: "1234" })], { ...payment, accountLastFour: undefined })).toBeNull();
  expect(matchPayment([bill({ accountLastFour: "1234" })], payment)?.id).toBe("b1");
  expect(matchPayment([bill({ accountLastFour: "1234" }), bill({ id: "b2", accountLastFour: "1234" })], payment)).toBeNull();
});
it("recognizes Xfinity's payment subject", () => {
  expect(classifyDocument("Thanks for your payment")).toBe("payment");
});
