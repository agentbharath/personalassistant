import { beforeEach, expect, it, vi } from "vitest";
const call = vi.hoisted(() => vi.fn());
vi.mock("@/lib/runtime/model-runtime", () => ({callClaude: call}));
import { classifyFinancialMail } from "./classifier";
import type { EmailSearchResult } from "@/lib/tools/email/google-gmail";
const messages = [{id: "one", from: "Unknown store", subject: "Thank you", snippet: "Order", date: "2026-09-20"}] as EmailSearchResult[];
beforeEach(() => {call.mockReset();});
it("supports previously unknown senders", async () => {
 call.mockResolvedValue({content: [{type: "text", text: '{"items":[{"id":"one","kind":"receipt"}]}'}]});
 expect(await classifyFinancialMail("u", messages)).toEqual({one: "receipt"});
});
it.each(['{"items":[]}', '{"items":[{"id":"invented","kind":"receipt"}]}', '{"items":[{"id":"one","kind":"receipt"},{"id":"one","kind":"promo"}]}'])("rejects incomplete or invented classification %s", async text => {
 call.mockResolvedValue({content: [{type: "text", text}]}); await expect(classifyFinancialMail("u", messages)).rejects.toThrow();
});
it("makes no model call for an empty batch", async () => {
 expect(await classifyFinancialMail("u", [])).toEqual({}); expect(call).not.toHaveBeenCalled();
});
