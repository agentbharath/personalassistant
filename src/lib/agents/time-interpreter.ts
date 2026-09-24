import { followupContext, FOLLOWUP_RULES } from "@/lib/conversations/followup";
import type Anthropic from "@anthropic-ai/sdk";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import type { InterpretationCache } from "./email-interpreter";
import { reportFailure } from "@/lib/observability/report";

/**
 * R20.5: which day, range or time a message means is read by a model, never by patterns. The model returns concrete local date-times; the
 * code below only checks their form (valid, ordered, a sensible length, a sensible year) and asks when the model says it is unsure (R22).
 */
export const TIME_INTERPRETER_VERSION = "time-v5";

export type CalendarWindow = { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime; label: string };

export type TimeReading =
  | { kind: "window"; window: CalendarWindow; /** A specific start time when the message named one, else null. */ moment: Temporal.ZonedDateTime | null; /** A place the message named, else null. */ place: string | null }
  | { kind: "ask"; question: string; choices: string[] }
  | { kind: "unavailable" };

export type TimeInput = { message: string; today: string; timeZone: string; userId: string; context?: { role: "user" | "assistant"; content: string; choices?: string[] }[] };
export type TimeDeps = { complete: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>; cache?: InterpretationCache | null };

const MAX_SPAN_DAYS = 62;
const MAX_YEAR_DISTANCE = 2;

export const TIME_SYSTEM = `${FOLLOWUP_RULES}\n\nYou read what day, date range or time of day a person means in a message to their calendar assistant. You do not answer the message. You return the exact window to look at, as local date-times with no offset, in the person's own time zone.

You are given today's date and weekday. Work out the dates yourself.
- kind "none": the message names no time at all. Use it only then; the assistant will show today.
- kind "day": one day, or part of a day. start and end are local date-times. A whole day runs from 00:00 that day to 00:00 the next day. "Afternoon" is 12:00 to 18:00, "morning" 05:00 to 12:00, "evening" 17:00 to 23:00, "tonight" 17:00 to 24:00.
- kind "range": several days, such as "this week", "next week", "the next 10 days", "in March". Use whole days, ending at 00:00 on the day after the last one. "This week" is today through Sunday. "Next week" is the coming Monday through Sunday. "The weekend" is Saturday and Sunday. "Last month" means the last 30 days.
- kind "moment": the message names a start time ("Saturday at 2pm"). start is that time and end is one hour later.
- kind "ambiguous": the message could reasonably mean two or more different times and the difference matters, for example an hour with no am or pm where both are plausible, a date that has already passed this year, or a weekday that could be this or next week. Put a short question in "question" and two to four short tappable answers in "choices". Never guess when in doubt; ask.
A bare weekday ("Monday", "on Friday") always means its next occurrence, counting today, and is never ambiguous: "Monday" said on a Monday is today. "Next Friday" means the Friday of the coming week. Years: a month and day with no year is in the current year and is NOT ambiguous when it is today or later ("10/15", "October 15", "oct 3rd"), so never ask "this year or next year" about a date that is still ahead; only when it has already passed this year is it ambiguous. Ask only when the difference really matters, not to be careful. "Morning" is always 05:00 to 12:00 of the named day, so "Saturday morning" is kind day, 05:00 to 12:00, not the whole day.
Fill "place" with a named location for an activity in the message ("AMC Bay Street", "Oakland Coliseum") and "" otherwise. Do not treat a time like "2pm" as a place.
"label" is a short phrase for the answer, such as "today", "tomorrow", "on Saturday, September 26", "over the next 7 days". Use "" when it does not matter.
"confidence" is 0 to 1. Fill fields that do not apply with "".`;

const outputSchema = z.object({
  kind: z.enum(["none", "day", "range", "moment", "ambiguous"]),
  start: z.string(),
  end: z.string(),
  label: z.string(),
  place: z.string(),
  question: z.string(),
  choices: z.array(z.string()),
  confidence: z.number(),
});
type Output = z.infer<typeof outputSchema>;

export const TIME_JSON_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["none", "day", "range", "moment", "ambiguous"] },
    start: { type: "string" },
    end: { type: "string" },
    label: { type: "string" },
    place: { type: "string" },
    question: { type: "string" },
    choices: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
  },
  required: ["kind", "start", "end", "label", "place", "question", "choices", "confidence"],
  additionalProperties: false,
} as const;

const ASK_FALLBACK = "Which day or time did you mean?";

export function buildTimeMessage(input: TimeInput) {
  const today = Temporal.PlainDate.from(input.today);
  const weekday = today.toLocaleString("en-US", { weekday: "long" });
  const recent = (input.context ?? []).slice(-4).map((item) => `${item.role}: ${item.content.slice(0, 300)}`);
  const history = (input.context ?? []).find(item => item.content.startsWith("Earlier conversation summary"))?.content.slice(0, 12000) ?? null;
  return JSON.stringify({ followupExchange: followupContext(input.context ?? [], input.message), history, today: input.today, weekday, timeZone: input.timeZone, recent, message: input.message });
}

/** Identical message + today + prompt version = identical reading, so repeated questions are repeatable and free (R16.3). */
export function timeCacheMaterial(input: TimeInput) {
  return [TIME_INTERPRETER_VERSION, input.userId, input.today, input.timeZone, input.message.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " "), buildTimeMessage({ ...input, message: "" })].join(" || ");
}

function parseLocal(value: string, timeZone: string): Temporal.ZonedDateTime | null {
  try { return Temporal.PlainDateTime.from(value.trim().replace(/Z$|[+-]\d\d:\d\d$/, "")).toZonedDateTime(timeZone); } catch { return null; }
}

function askFrom(output: Output): TimeReading {
  const choices = [...new Set(output.choices.map((choice) => choice.trim()).filter(Boolean))].slice(0, 4);
  return { kind: "ask", question: output.question.trim() || ASK_FALLBACK, choices: choices.length >= 2 ? choices : [] };
}

/** Checks the form of the model's answer only. Anything unusable becomes a question to the person, never a guess. */
export function toReading(output: Output, input: TimeInput): TimeReading {
  const today = Temporal.PlainDate.from(input.today);
  const midnight = today.toZonedDateTime({ timeZone: input.timeZone, plainTime: { hour: 0 } });
  if (output.kind === "ambiguous") return askFrom(output);
  const place = output.place.trim() || null;
  if (output.kind === "none") return { kind: "window", window: { start: midnight, end: midnight.add({ days: 1 }), label: "today" }, moment: null, place };

  const start = parseLocal(output.start, input.timeZone);
  let end = parseLocal(output.end, input.timeZone);
  if (!start) return askFrom({ ...output, question: "", choices: [] });
  if (output.kind === "moment" && !end) end = start.add({ hours: 1 });
  if (!end || Temporal.ZonedDateTime.compare(end, start) <= 0) return askFrom({ ...output, question: "", choices: [] });
  if (Math.abs(start.year - today.year) > MAX_YEAR_DISTANCE) return askFrom({ ...output, question: `Did you mean ${start.toPlainDate().toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric" })}?`, choices: [] });
  if (start.until(end, { largestUnit: "days" }).total({ unit: "days", relativeTo: start }) > MAX_SPAN_DAYS) return askFrom({ ...output, question: "That covers a lot of days. Which stretch would you like to see?", choices: [] });

  const label = output.label.trim() || `on ${start.toPlainDate().toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" })}`;
  if (output.kind === "moment") {
    const dayStart = start.startOfDay();
    return { kind: "window", window: { start: dayStart, end: dayStart.add({ days: 1 }), label }, moment: start, place };
  }
  return { kind: "window", window: { start, end, label }, moment: null, place };
}

export async function interpretTime(input: TimeInput, deps: TimeDeps): Promise<TimeReading> {
  const material = timeCacheMaterial(input);
  try {
    const cached = await deps.cache?.get(material);
    if (cached) return toReading(outputSchema.parse(JSON.parse(cached)), input);
  } catch { /* A cache problem never blocks an answer. */ }

  try {
    const response = await deps.complete({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      temperature: 0,
      system: TIME_SYSTEM,
      messages: [{ role: "user", content: buildTimeMessage(input) }],
      output_config: { format: { type: "json_schema", schema: TIME_JSON_SCHEMA } },
    });
    const block = response.content.find((item) => item.type === "text");
    if (!block || block.type !== "text") throw new Error("TIME_OUTPUT_MISSING");
    const output = outputSchema.parse(JSON.parse(block.text));
    try { await deps.cache?.set(material, JSON.stringify(output)); } catch { /* optional */ }
    return toReading(output, input);
  } catch (error) {
    reportFailure("time_interpreter_unavailable", error, { version: TIME_INTERPRETER_VERSION });
    return { kind: "unavailable" };
  }
}

/** What to tell the person when no model could read the time. Nothing is looked up (R20.5). */
export const TIME_UNAVAILABLE = "I can't work out which day you mean right now (the AI model isn't available), so I haven't looked at your calendar. Please try again in a bit.";
