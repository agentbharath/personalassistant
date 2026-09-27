import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reading: null as unknown }));
vi.mock("./time-interpreter-runtime", () => ({ interpretTimeForUser: async () => mocks.reading }));

import { extractFlightSlots } from "./flight-query";

const reply = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] }) as never;
const complete = (value: unknown) => vi.fn().mockResolvedValue(reply(value));

describe("flight slot extraction (R32)", () => {
  it("resolves a stated date through the same shared time interpreter every other date reference uses", async () => {
    mocks.reading = { kind: "window", window: { start: { toPlainDate: () => ({ toString: () => "2026-11-06" }) } } };
    const outcome = await extractFlightSlots("flights from SJC to LAS next Friday", null, "2026-09-25", "u1", complete({ originCode: "SJC", destinationCode: "LAS", dateText: "next Friday", tripType: "one_way" }));
    expect(outcome).toEqual({ kind: "slots", slots: { origin: "SJC", destination: "LAS", date: "2026-11-06", dateStatus: "stated", tripType: "one_way", tripTypeStatus: "stated" } });
  });

  it("marks the date and trip type assumed, never silently presented as stated, when the request doesn't say", async () => {
    const outcome = await extractFlightSlots("cheapest flights to Vegas", null, "2026-09-25", "u1", complete({ originCode: "SJC", destinationCode: "LAS", dateText: "", tripType: "unspecified" }));
    expect(outcome.kind).toBe("slots");
    if (outcome.kind !== "slots") throw new Error("expected slots");
    expect(outcome.slots.dateStatus).toBe("assumed");
    expect(outcome.slots.tripType).toBe("one_way");
    expect(outcome.slots.tripTypeStatus).toBe("assumed");
  });

  it("asks rather than guessing when the origin or destination can't be resolved to a real airport code", async () => {
    const noOrigin = await extractFlightSlots("cheapest flights somewhere", null, "2026-09-25", "u1", complete({ originCode: "", destinationCode: "LAS", dateText: "", tripType: "unspecified" }));
    expect(noOrigin).toMatchObject({ kind: "ask" });
    const noDestination = await extractFlightSlots("flights from SJC", null, "2026-09-25", "u1", complete({ originCode: "SJC", destinationCode: "not-a-code", dateText: "", tripType: "unspecified" }));
    expect(noDestination).toMatchObject({ kind: "ask" });
  });

  it("passes the ambiguous-date question straight through when the time interpreter needs to ask", async () => {
    mocks.reading = { kind: "ask", question: "Which Friday did you mean?", choices: ["This one", "Next one"] };
    const outcome = await extractFlightSlots("flights to Vegas next Friday", null, "2026-09-25", "u1", complete({ originCode: "SJC", destinationCode: "LAS", dateText: "next Friday", tripType: "unspecified" }));
    expect(outcome).toEqual({ kind: "ask", question: "Which Friday did you mean?", choices: ["This one", "Next one"] });
  });

  it("degrades to unavailable, never a crash, on a malformed or missing model response", async () => {
    const malformed = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "{\"originCode\": not valid json" }] });
    expect(await extractFlightSlots("x", null, "2026-09-25", "u1", malformed)).toEqual({ kind: "unavailable" });
    expect(await extractFlightSlots("x", null, "2026-09-25", "u1", vi.fn().mockResolvedValue({ content: [] }))).toEqual({ kind: "unavailable" });
  });
});
