import { describe, expect, it } from "vitest";
import { buildRawMessage, draftProblems, normalizeBody } from "./mime";

const decodeRaw = (raw: string) => Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const body = (message: string) => Buffer.from(message.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
const spec = { to: ["sarah@example.com"], subject: "Friday", body: "I'll be there." };

describe("building a draft message", () => {
  it("writes the headers and a base64 body", () => {
    const message = decodeRaw(buildRawMessage(spec));
    expect(message).toContain("To: sarah@example.com");
    expect(message).toContain("Subject: Friday");
    expect(message).toContain("Content-Transfer-Encoding: base64");
    expect(body(message)).toBe("I'll be there.");
  });

  it("threads a reply under the message it answers", () => {
    const message = decodeRaw(buildRawMessage({ ...spec, inReplyTo: { messageId: "abc123@mail.example.com", references: ["<first@mail.example.com>"] } }));
    expect(message).toContain("In-Reply-To: <abc123@mail.example.com>");
    expect(message).toContain("References: <first@mail.example.com> <abc123@mail.example.com>");
  });

  it("adds Cc and encodes a non-ASCII subject and body safely", () => {
    const message = decodeRaw(buildRawMessage({ to: ["a@example.com"], cc: ["b@example.com"], subject: "Réunion demain — café ☕", body: "Bonjour, à demain ☕" }));
    expect(message).toContain("Cc: b@example.com");
    expect(message).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(body(message)).toBe("Bonjour, à demain ☕");
  });
});

describe("what makes a draft unsafe or malformed (form only)", () => {
  it("needs a recipient, valid addresses and some text", () => {
    expect(draftProblems({ ...spec, to: [] })).toContain("A draft needs at least one recipient.");
    expect(draftProblems({ ...spec, to: ["not-an-address"] }).join(" ")).toMatch(/not a valid email address/);
    expect(draftProblems({ ...spec, body: "   " })).toContain("The draft has no text.");
  });

  it("rejects header injection in every field", () => {
    expect(draftProblems({ ...spec, subject: "Hi\r\nBcc: attacker@evil.example" }).join(" ")).toMatch(/line break/);
    expect(draftProblems({ ...spec, to: ["a@example.com\r\nBcc: x@evil.example"] }).join(" ")).toMatch(/not a valid email address/);
    expect(draftProblems({ ...spec, to: ["a@example.com,b@evil.example"] }).join(" ")).toMatch(/not a valid email address/);
    expect(draftProblems({ ...spec, inReplyTo: { messageId: "x\r\nBcc: y@evil.example" } }).join(" ")).toMatch(/reply reference/);
    expect(() => buildRawMessage({ ...spec, subject: "Hi\nBcc: x@evil.example" })).toThrow(/DRAFT_INVALID/);
  });

  it("caps recipients, subject and body length", () => {
    expect(draftProblems({ ...spec, to: Array.from({ length: 21 }, (_, index) => `p${index}@example.com`) }).join(" ")).toMatch(/at most 20/);
    expect(draftProblems({ ...spec, subject: "s".repeat(301) })).toContain("The subject is too long.");
    expect(draftProblems({ ...spec, body: "b".repeat(50_001) })).toContain("The draft is too long.");
  });
});

describe("noticing an edit made in Gmail", () => {
  it("ignores line endings and trailing spaces, but not real changes", () => {
    expect(normalizeBody("Hello  \r\nthere\r\n")).toBe(normalizeBody("Hello\nthere"));
    expect(normalizeBody("Hello there")).not.toBe(normalizeBody("Hello there!"));
  });
});
