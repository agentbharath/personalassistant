import { readFileSync } from "node:fs";
import { QueryBudgetUnavailableError } from "@/lib/runtime/query-budget";
import { ensureRequestTime } from "@/lib/runtime/request-context";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({get:vi.fn(),append:vi.fn(),run:vi.fn(),writeMemories:vi.fn(),after:vi.fn((cb:() => unknown)=>cb())}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getClaims:async()=>({data:{claims:{sub:"user"}}})}})}));
vi.mock("@/lib/orchestrator/run",()=>({runOrchestrator:mocks.run}));
vi.mock("@/lib/conversations/store",()=>({getConversation:mocks.get,appendMessage:mocks.append,createConversation:vi.fn().mockResolvedValue("conv-id"),compactConversationContext:vi.fn().mockResolvedValue(undefined),latestSequence:vi.fn().mockResolvedValue("2")}));
vi.mock("next/server",()=>({after:mocks.after}));
vi.mock("@/lib/memory/extractor-runtime",()=>({writeMemoriesFromMessage:mocks.writeMemories}));
vi.mock("@/lib/observability/query-telemetry",()=>({recordQueryTelemetry:vi.fn().mockResolvedValue(undefined)}));
import { POST } from "./route";
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
beforeEach(()=>{vi.clearAllMocks();mocks.append.mockReset();mocks.run.mockReset();mocks.get.mockReset();vi.spyOn(console,"error").mockImplementation(()=>undefined);});
it.each(["load","save"])("does not run a follow-up after a chat %s failure",async(stage)=>{
  mocks.get.mockResolvedValue({contextMessages:[{role:"assistant",content:"Search for sudoku code?"}]});
  mocks.append.mockResolvedValue(undefined);
  if(stage==="load")mocks.get.mockRejectedValue(new Error("offline"));
  else mocks.append.mockRejectedValue(new Error("offline"));
  const response=await POST(new Request("http://localhost/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:"yes",conversationId:"00000000-0000-4000-8000-000000000001"})}));
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({retryable:true,message:expect.stringContaining("haven’t processed")});
  expect(mocks.run).not.toHaveBeenCalled();
});

it("never re-reads the message for background memory extraction after an explicit \"remember that...\" already handled it deliberately (R.memory, found live)", async () => {
  mocks.get.mockResolvedValue({ contextMessages: [] });
  mocks.append.mockResolvedValue(undefined);
  mocks.run.mockResolvedValue({ requestId: "r1", answer: "Got it.", agents: [], confidence: 1, status: "completed", operation: "memory_remember" });
  const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "remember that I don't eat meat except chicken, fish and shrimp", conversationId: "00000000-0000-4000-8000-000000000001" }) }));
  expect(response.status).toBe(200);
  expect(mocks.writeMemories).not.toHaveBeenCalled();
});

it("still runs background memory extraction for an ordinary message (no regression)", async () => {
  mocks.get.mockResolvedValue({ contextMessages: [] });
  mocks.append.mockResolvedValue(undefined);
  mocks.run.mockResolvedValue({ requestId: "r1", answer: "Sure.", agents: ["general"], confidence: 1, status: "completed", operation: "web_search" });
  await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "best sushi near me", conversationId: "00000000-0000-4000-8000-000000000001" }) }));
  expect(mocks.writeMemories).toHaveBeenCalledWith("user", "best sushi near me");
});

const failureCases = readFileSync("evals/chat-failures.jsonl", "utf8").trim().split("\n").map(line => JSON.parse(line));
it.each(failureCases)("$id: saves the notice before streaming the failure", async ({ input, failure, status, error, retryable }) => {
  mocks.append.mockResolvedValue(undefined);
  mocks.run.mockRejectedValue(failure === "provider" ? new Error("offline") : new QueryBudgetUnavailableError(failure));
  const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json", accept: "application/x-ndjson" }, body: JSON.stringify({ message: input }) }));
  const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
  expect(events.at(-1)).toMatchObject({ type: "result", status, body: { error, retryable, conversationId: "conv-id", sequence: "2" } });
  expect(mocks.append).toHaveBeenLastCalledWith("user", "conv-id", { role: "assistant", content: events.at(-1).body.message, notice: true, retryable });
});

it("returns the original failure with a persistence warning if its notice cannot be saved", async () => {
  mocks.append.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("storage offline"));
  mocks.run.mockRejectedValue(new QueryBudgetUnavailableError("time"));
  const response = await POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ message: "any recent sports news?" }) }));
  expect(response.status).toBe(504);
  expect(await response.json()).toMatchObject({ error: "QUERY_TIMED_OUT", retryable: true, persistenceWarning: expect.stringContaining("couldn’t be saved") });
});

it("lets a news stage finish after 20 seconds when it extends the shared deadline", async () => {
  vi.useFakeTimers();
  mocks.append.mockResolvedValue(undefined);
  mocks.run.mockImplementation(async () => {
    ensureRequestTime(60_000);
    await new Promise(resolve => setTimeout(resolve, 25_000));
    return { requestId: "r1", answer: "News ready.", agents: ["general"], confidence: 1, status: "completed", operation: "web_search" };
  });
  const pending = POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ message: "any recent sports news?" }) }));
  await vi.advanceTimersByTimeAsync(25_001);
  const response = await pending;
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ answer: "News ready." });
});

it("still stops a stalled news request at its extended deadline and saves the timeout", async () => {
  vi.useFakeTimers();
  mocks.append.mockResolvedValue(undefined);
  mocks.run.mockImplementation(async () => { ensureRequestTime(60_000); return new Promise(() => {}); });
  const pending = POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ message: "any recent sports news?" }) }));
  await vi.advanceTimersByTimeAsync(60_001);
  const response = await pending;
  expect(response.status).toBe(504);
  expect(mocks.append).toHaveBeenLastCalledWith("user", "conv-id", expect.objectContaining({ notice: true, retryable: true }));
});
