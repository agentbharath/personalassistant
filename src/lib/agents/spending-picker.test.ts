import { describe, expect, it } from "vitest";
import { buildPickerMessage, pickSpendingEmails, type PickableEmail } from "./spending-picker";

const mail = (id: string): PickableEmail => ({ id, from: `Store ${id} <a@b.com>`, subject: `Subject ${id}`, snippet: "text", date: "Fri, 11 Sep 2026" });
const reply = (numbers: number[]) => ({ content: [{ type: "text", text: JSON.stringify({ purchases: numbers }) }] }) as never;

describe("the spending picker (free)", () => {
  it("returns the emails the model numbered, ignoring numbers that do not exist", async () => {
    const result = await pickSpendingEmails("u", [mail("a"), mail("b"), mail("c")], { complete: async () => reply([1, 3, 9, 0]), cache: null });
    expect(result).toEqual({ ids: ["a", "c"], unavailable: false });
  });

  it("is unavailable, and picks nothing, when the model cannot answer (no rule fallback)", async () => {
    const result = await pickSpendingEmails("u", [mail("a")], { complete: async () => { throw new Error("down"); }, cache: null });
    expect(result).toEqual({ ids: [], unavailable: true });
  });

  it("sends 40 emails per call and remembers answers so a repeat costs nothing", async () => {
    const store = new Map<string, string>();
    const cache = { get: async (key: string) => store.get(key) ?? null, set: async (key: string, value: string) => { store.set(key, value); } };
    let calls = 0;
    const complete = async () => { calls += 1; return reply([1]); };
    const emails = Array.from({ length: 85 }, (_, index) => mail(String(index)));
    await pickSpendingEmails("u", emails, { complete, cache });
    expect(calls).toBe(3);
    const again = await pickSpendingEmails("u", emails, { complete, cache });
    expect(calls).toBe(3);
    expect(again.ids).toEqual(["0", "40", "80"]);
  });

  it("numbers emails from 1 and keeps the text short", () => {
    const message = JSON.parse(buildPickerMessage([{ ...mail("a"), snippet: "x".repeat(1000) }])) as { emails: Array<{ n: number; text: string }> };
    expect(message.emails[0].n).toBe(1);
    expect(message.emails[0].text.length).toBe(200);
  });
});
