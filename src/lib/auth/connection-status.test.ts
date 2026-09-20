import { beforeEach, describe, expect, it, vi } from "vitest";

const broker = vi.hoisted(() => ({ result: null as null | Error }));
vi.mock("./google-credential-broker", () => {
  class GoogleConnectionRequiredError extends Error {}
  return {
    GoogleConnectionRequiredError,
    withGoogleCredential: async (_user: string, _capability: string, operation: (token: string) => Promise<unknown>) => {
      if (broker.result) throw broker.result;
      return operation("token");
    },
  };
});

import { GoogleConnectionRequiredError } from "./google-credential-broker";
import { checkGoogleConnection } from "./connection-status";

beforeEach(() => { broker.result = null; });

describe("live Google connection check", () => {
  it("is connected when the broker can use the credential", async () => {
    expect(await checkGoogleConnection("u1", "email")).toBe("connected");
  });
  it("needs reconnecting when Google no longer grants it", async () => {
    broker.result = new (GoogleConnectionRequiredError as unknown as new () => Error)();
    expect(await checkGoogleConnection("u1", "calendar")).toBe("needs_reconnect");
  });
  it("is unavailable, not disconnected, on a network or storage failure", async () => {
    broker.result = new Error("fetch failed");
    expect(await checkGoogleConnection("u1", "email")).toBe("unavailable");
  });
});
