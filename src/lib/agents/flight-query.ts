import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { Temporal } from "@js-temporal/polyfill";
import { interpretTimeForUser } from "./time-interpreter-runtime";

const TIME_ZONE = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";

const outputSchema = z.object({
  originCode: z.string(), destinationCode: z.string(),
  dateText: z.string(), tripType: z.enum(["one_way", "round_trip", "unspecified"]),
});
const JSON_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["originCode", "destinationCode", "dateText", "tripType"],
  properties: {
    originCode: { type: "string" }, destinationCode: { type: "string" },
    dateText: { type: "string" }, tripType: { type: "string", enum: ["one_way", "round_trip", "unspecified"] },
  },
} as const;

export type FlightSlots = {
  origin: string; destination: string;
  date: string; dateStatus: "stated" | "assumed";
  tripType: "one_way" | "round_trip"; tripTypeStatus: "stated" | "assumed";
};
export type FlightSlotsOutcome = { kind: "slots"; slots: FlightSlots } | { kind: "ask"; question: string; choices: string[] } | { kind: "unavailable" };

const IATA = /^[A-Z]{3}$/;

/** R20.5: airport-code resolution (including "Sunnyvale has no airport, use San Jose") is real-world knowledge, the same kind of thing the
 * router already resolves from a model ("Ginger Cafe" from context, a holiday's date) — not a classification decision, so a static
 * lookup table would be the wrong tool here. The date itself still goes through the one shared time interpreter (R20.5, no second parser). */
export async function extractFlightSlots(query: string, homeLocation: string | null, today: string, userId: string, complete: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>): Promise<FlightSlotsOutcome> {
  const response = await complete({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    temperature: 0,
    system: `Read a flight search request and give the two airports as IATA codes and the date as the person said it. originCode: the departure airport's IATA code. If the request names no origin, use the nearest major commercial airport to this saved home location, if given: ${homeLocation ?? "none saved"}. destinationCode: the arrival airport's IATA code for the named city or airport. Use the largest or most obviously intended commercial airport for a city with several (Los Angeles: LAX). dateText: the date or date phrase exactly as the person said it ("next Friday", "in November", ""); "" if truly no date is mentioned. tripType: one_way or round_trip if the person said which, else unspecified. Return "" for a code you cannot confidently resolve. Return JSON only.`,
    messages: [{ role: "user", content: query }],
    output_config: { format: { type: "json_schema", schema: JSON_SCHEMA } },
  });
  const block = response.content.find((item) => item.type === "text");
  if (!block || block.type !== "text") return { kind: "unavailable" };
  let output: z.infer<typeof outputSchema>;
  try { output = outputSchema.parse(JSON.parse(block.text)); } catch { return { kind: "unavailable" }; }

  const origin = output.originCode.trim().toUpperCase();
  const destination = output.destinationCode.trim().toUpperCase();
  if (!IATA.test(origin)) return { kind: "ask", question: "Which city or airport are you flying from?", choices: [] };
  if (!IATA.test(destination)) return { kind: "ask", question: "Which city or airport are you flying to?", choices: [] };

  let date = Temporal.Now.zonedDateTimeISO(TIME_ZONE).toPlainDate().add({ days: 21 }).toString();
  let dateStatus: "stated" | "assumed" = "assumed";
  if (output.dateText.trim()) {
    const reading = await interpretTimeForUser({ message: output.dateText, today, timeZone: TIME_ZONE, userId, context: [] });
    if (reading.kind === "unavailable") return { kind: "unavailable" };
    if (reading.kind === "ask") return { kind: "ask", question: reading.question, choices: reading.choices };
    date = reading.window.start.toPlainDate().toString();
    dateStatus = "stated";
  }

  return {
    kind: "slots",
    slots: {
      origin, destination, date, dateStatus,
      tripType: output.tripType === "round_trip" ? "round_trip" : "one_way",
      tripTypeStatus: output.tripType === "unspecified" ? "assumed" : "stated",
    },
  };
}
