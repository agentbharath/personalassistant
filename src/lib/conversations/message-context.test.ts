import { expect, it, vi } from "vitest";
vi.mock("@/lib/security/encryption", () => ({ decryptText: (value: string) => JSON.parse(value).plaintext }));
import { messageChoices } from "./message-context";
it("restores saved choices and tolerates older messages without them", () => {
  expect(messageChoices(JSON.stringify({plaintext: JSON.stringify({choices:["Daylark drafts", "Gmail drafts"]})}))).toEqual({choices:["Daylark drafts", "Gmail drafts"]});
  expect(messageChoices(null)).toEqual({});
  expect(messageChoices("corrupt")).toEqual({});
  expect(messageChoices(JSON.stringify({plaintext:JSON.stringify({choices:[false, "Valid", "x".repeat(201)]})}))).toEqual({choices:["Valid"]});
});

it("reads notice metadata even without choices, including an explicit false retry flag", () => {
  const encoded = (value: unknown) => JSON.stringify({ plaintext: JSON.stringify(value) });
  expect(messageChoices(encoded({ notice: true, retryable: true }))).toEqual({ notice: true, retryable: true });
  expect(messageChoices(encoded({ notice: true, retryable: false }))).toEqual({ notice: true, retryable: false });
  expect(messageChoices(encoded({ notice: "yes", retryable: "false" }))).toEqual({});
});
