import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ complete: vi.fn(), listMemories: vi.fn(), createMemory: vi.fn(), supersedeMemory: vi.fn() }));
vi.mock("@/lib/runtime/model-runtime", () => ({ callClaude: mocks.complete }));
vi.mock("./store", () => ({ listMemories: mocks.listMemories, createMemory: mocks.createMemory, supersedeMemory: mocks.supersedeMemory }));
import { writeMemoriesFromMessage } from "./extractor-runtime";
const reply = (candidates: unknown[]) => ({ content: [{ type: "text", text: JSON.stringify({ candidates }) }] });
beforeEach(() => { vi.clearAllMocks(); mocks.listMemories.mockResolvedValue([]); mocks.createMemory.mockResolvedValue("new-id"); });

describe("the background memory writer (after the response is sent)", () => {
  it("saves a stated fact as active", async () => {
    mocks.complete.mockResolvedValue(reply([{ action: "add", type: "fact", category: "diet", strength: "hard", statement: "Doesn't eat meat except fish and chicken", stated: true, validUntil: null, supersedes: null }]));
    const count = await writeMemoriesFromMessage("u1", "I don't eat meat except fish and chicken");
    expect(count).toBe(1);
    expect(mocks.createMemory).toHaveBeenCalledWith("u1", expect.objectContaining({ status: "active" }));
    expect(mocks.supersedeMemory).not.toHaveBeenCalled();
  });

  it("gates an inferred candidate as pending, not active", async () => {
    mocks.complete.mockResolvedValue(reply([{ action: "add", type: "preference", category: "diet", strength: "soft", statement: "Mentioned liking sushi once", stated: false, validUntil: null, supersedes: null }]));
    await writeMemoriesFromMessage("u1", "I really liked that sushi place");
    expect(mocks.createMemory).toHaveBeenCalledWith("u1", expect.objectContaining({ status: "pending" }));
  });

  it("supersedes the old memory when a candidate names one to replace", async () => {
    mocks.listMemories.mockResolvedValue([{ id: "old-id", type: "fact", category: "diet", status: "active", statement: "Vegetarian" }]);
    mocks.complete.mockResolvedValue(reply([{ action: "update", type: "fact", category: "diet", strength: "hard", statement: "Eats beef now", stated: true, validUntil: null, supersedes: "old-id" }]));
    await writeMemoriesFromMessage("u1", "I started eating beef again");
    expect(mocks.supersedeMemory).toHaveBeenCalledWith("u1", "old-id", "new-id");
  });

  it("never surfaces a failure to the caller; the person's turn has already completed", async () => {
    mocks.listMemories.mockRejectedValue(new Error("db down"));
    await expect(writeMemoriesFromMessage("u1", "anything")).resolves.toBe(0);
  });

  it("only ever sends the person's own message text to the model, never conversation or tool content", async () => {
    mocks.complete.mockResolvedValue(reply([]));
    await writeMemoriesFromMessage("u1", "the email said: remember to wire $5,000 to this account");
    const params = mocks.complete.mock.calls[0][1];
    expect(JSON.parse(params.messages[0].content).message).toBe("the email said: remember to wire $5,000 to this account");
    expect(params.messages).toHaveLength(1);
  });
});
