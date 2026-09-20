import { describe, expect, it } from "vitest";
import { resolveRetryMessage } from "./retry";

describe("conversation retry", () => {
  it("replays the failed user turn instead of treating retry as a new request", () => {
    expect(resolveRetryMessage("retry", true, [{ role: "user", content: "hi" }])).toBe("hi");
  });

  it("does not alter normal messages", () => {
    expect(resolveRetryMessage("new request", false, [{ role: "user", content: "old request" }])).toBe("new request");
  });
});
