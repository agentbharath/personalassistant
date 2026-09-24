import { expect, it, vi } from "vitest";
const complete = vi.hoisted(() => vi.fn(async () => ({ content: [{ type: "text", text: "Ginger Cafe was on that list." }] })));
vi.mock("@/lib/runtime/model-runtime", () => ({ callClaude: complete }));
import { answerGeneral } from "./claude";
it("keeps historical recall and the immediately preceding topic in the answer prompt", async () => {
  await answerGeneral("Tell me what you remember about them", [
    { role: "assistant", content: "Earlier conversation summary:\nSaved search records: Ginger Cafe, Chinese restaurants in Sunnyvale, searched yesterday." },
    { role: "user", content: "Do you remember the Chinese restaurants from yesterday?" },
  ]);
  const request = complete.mock.calls[0] as unknown as [string, { messages: { content: string }[] }];
  expect(request[1].messages[0].content).toContain("Ginger Cafe");
  expect(request[1].messages[0].content).toContain("Chinese restaurants from yesterday");
});
