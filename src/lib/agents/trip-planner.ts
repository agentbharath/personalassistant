import type Anthropic from "@anthropic-ai/sdk";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { askAboutTime, listCalendarForWindow } from "./calendar";
import { TIME_UNAVAILABLE } from "./time-interpreter";
import { interpretTimeForUser } from "./time-interpreter-runtime";
import { searchPublicWeb } from "@/lib/tools/general/tavily-search";
import { calculateDrivingRoute } from "@/lib/tools/maps/routes";
import { loadLearnings } from "@/lib/learning/store";
import { configuredModel, prepareAgentStage } from "@/lib/runtime/query-budget";
import { supportsTemperature } from "@/lib/runtime/model-runtime";
import { extendRequestBudget } from "@/lib/runtime/request-context";
import { DAYLARK_PERSONA } from "@/lib/model/persona";
import { plain } from "./search-answer";
import { reportFailure } from "@/lib/observability/report";

/** Same shape as `callClaude`'s own (operation, params): production supplies the real, budget-tracked model call (trip-planner-runtime.ts);
 * a live eval supplies a raw, spend-metered client call instead — the same deps-injection R20.5 already uses for the time interpreter,
 * so the two model calls here can be verified live without forcing them through this session's per-call SpendMeter framework blind. */
export type TripPlannerDeps = { complete: (operation: string, params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message> };

/** A full plan does several parallel searches and up to three model calls (one at the "high" tier) — comfortably more time and cost than
 * the default per-request budget, which exists to keep an ordinary quick lookup cheap, not to cap a request that asks for a real plan. */
const PLAN_BUDGET = { totalMs: 120_000, costLimitUsd: 0.75 } as const;

/**
 * A real, code-driven itinerary pipeline, for requests that ask Daylark to PLAN something (a trip, a multi-day visit), as distinct from a
 * single-shot lookup ("Chinese restaurants in Sunnyvale") that `agents/general.ts` already handles well. A single search-and-summarize call
 * cannot produce a day-by-day plan no matter how the prompt is worded: this is a genuinely different shape of work — resolve dates, gather
 * enough real material across several queries, extract candidates, compose a structured itinerary with a stronger model, and check it against
 * its own spec before it's shown. Bump TRIP_PLANNER_VERSION on any change to a prompt or schema below.
 */
export const TRIP_PLANNER_VERSION = "trip-plan-v1";

type FieldStatus = "stated" | "assumed" | "missing";
type Source = { title: string; url: string; snippet: string };

export type TripSpec = {
  destination: string;
  origin: string | null; originStatus: FieldStatus;
  start: Temporal.PlainDate; endExclusive: Temporal.PlainDate; label: string; dateStatus: FieldStatus;
  partySize: number; partyStatus: FieldStatus;
  pace: "relaxed" | "moderate" | "packed"; paceStatus: FieldStatus;
  /** The user's own calendar during the trip window, read as an input to the plan (never appended as its own separate section — R32). */
  commitments: string[];
};

type SpecOutcome = { kind: "spec"; spec: TripSpec } | { kind: "ask"; question: string; choices: string[] } | { kind: "unavailable" };

const TIME_ZONE = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";
const dayCount = (spec: TripSpec) => spec.start.until(spec.endExclusive).days;
const monthDay = (date: Temporal.PlainDate) => date.toLocaleString("en-US", { month: "short", day: "numeric" });
const dateRangeLabel = (spec: TripSpec) => `${monthDay(spec.start)}–${monthDay(spec.endExclusive.subtract({ days: 1 }))}, ${spec.start.year}`;

/** R20.5: the trip's dates are read by the same model-based time interpreter every other date reference in Daylark goes through — never a
 * new date parser. Origin comes from the same saved home location "near me" already uses. Everything not actually said is marked "assumed"
 * so the composer can say so, instead of silently presenting a guess as a stated fact. */
export async function buildTripSpec(destination: string, dateText: string, userId: string, context: { role: "user" | "assistant"; content: string }[] = []): Promise<SpecOutcome> {
  const today = Temporal.Now.zonedDateTimeISO(TIME_ZONE).toPlainDate().toString();
  const reading = await interpretTimeForUser({ message: dateText, today, timeZone: TIME_ZONE, userId, context });
  if (reading.kind === "unavailable") return { kind: "unavailable" };
  if (reading.kind === "ask") return { kind: "ask", question: reading.question, choices: reading.choices };

  const learnings = await loadLearnings(userId).catch(() => undefined);
  const origin = learnings?.homeLocation ?? null;
  const spec: TripSpec = {
    destination,
    origin, originStatus: origin ? "stated" : "missing",
    start: reading.window.start.toPlainDate(), endExclusive: reading.window.end.toPlainDate(), label: reading.window.label, dateStatus: "stated",
    partySize: 1, partyStatus: "assumed",
    pace: "moderate", paceStatus: "assumed",
    commitments: [],
  };
  const events = await listCalendarForWindow(userId, reading.window).catch(() => []);
  spec.commitments = events.filter((event) => !event.allDay).slice(0, 10).map((event) => {
    const time = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(event.start));
    return `${time}${event.location ? ` at ${event.location}` : ""} — ${event.summary}`;
  });
  return { kind: "spec", spec };
}

/** Several real queries, not one: a plan needs enough material to fill a multi-day itinerary, which a single 5-result "basic" lookup was
 * never built to supply. Best-effort per query (Promise.allSettled): one failed query never sinks the whole plan. */
async function researchTrip(spec: TripSpec): Promise<Source[]> {
  const year = spec.start.year;
  const queries = [
    `best things to do in ${spec.destination}`,
    `${spec.destination} events ${dateRangeLabel(spec)} ${year}`,
    `where to eat in ${spec.destination}`,
    `getting around ${spec.destination}, travel tips`,
  ];
  const settled = await Promise.allSettled(queries.map((query) => searchPublicWeb(query, { depth: "advanced", maxResults: 6, snippetLength: 1200 })));
  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const source of result.value.sources) {
      if (seen.has(source.url)) continue;
      seen.add(source.url);
      sources.push(source);
    }
  }
  return sources.slice(0, 20);
}

const candidateSchema = z.object({ name: z.string(), category: z.enum(["activity", "food", "lodging", "logistics", "event"]), detail: z.string(), dated: z.boolean(), eventDateNote: z.string(), source: z.number() });
const candidatesSchema = z.object({ candidates: z.array(candidateSchema) });
type Candidate = z.infer<typeof candidateSchema>;
const CANDIDATES_JSON_SCHEMA = {
  type: "object", additionalProperties: false, required: ["candidates"],
  properties: { candidates: { type: "array", items: {
    type: "object", additionalProperties: false, required: ["name", "category", "detail", "dated", "eventDateNote", "source"],
    properties: {
      name: { type: "string" }, category: { type: "string", enum: ["activity", "food", "lodging", "logistics", "event"] },
      detail: { type: "string" }, dated: { type: "boolean" },
      eventDateNote: { type: "string" }, source: { type: "number" },
    },
  } } },
} as const;

/** One model call turns raw evidence into named, sourced candidates the composer can build days from — never letting the composer read
 * 20 raw snippets itself, which is how a single-shot answer ends up vague ("various local attractions"). */
async function extractCandidates(spec: TripSpec, sources: Source[], deps: TripPlannerDeps): Promise<Candidate[]> {
  if (!sources.length) return [];
  const evidence = sources.map((source, index) => `[${index + 1}] ${source.title}\nURL: ${source.url}\nEvidence: ${source.snippet}`).join("\n\n");
  prepareAgentStage(["general"], "fast");
  const extractionModel = configuredModel("fast");
  try {
    const response = await deps.complete("trip_candidate_extraction", {
      model: extractionModel,
      // Up to 20 candidates, each with a full detail sentence, genuinely needs more than a short answer's worth of tokens — too tight a
      // cap here does not shorten the list, it truncates the JSON mid-object and fails the whole extraction (caught below either way).
      max_tokens: 2200,
      // `temperature` is rejected outright by the newer Sonnet/Opus generation (confirmed against the API; see model-runtime.ts) — sent
      // only for a model that actually supports it, not stripped downstream, so this call is correct through a raw client too (a live eval).
      ...(supportsTemperature(extractionModel) ? { temperature: 0 } : {}),
      system: `You read search evidence about a trip to ${spec.destination} (${dateRangeLabel(spec)}) and list real, named candidates worth including: specific activities, restaurants, neighborhoods or landmarks, lodging notes, transit/logistics tips, and dated events. Only from the evidence given — never invent a name, address, hour or price the evidence doesn't state. category: activity, food, lodging, logistics or event. detail: the one specific, useful fact about it (what it's known for, a practical tip), plain and un-marketed. dated: true only for something tied to a specific calendar date or season (a festival, a seasonal closure). eventDateNote: for a dated item, the exact year/date the evidence gives (so a stale year can be caught later); "" otherwise. source: the evidence number it came from. List up to 20, the strongest ones first; skip anything too generic to actually visit or do ("various shops downtown"). Return JSON only.`,
      messages: [{ role: "user", content: evidence }],
      output_config: { format: { type: "json_schema", schema: CANDIDATES_JSON_SCHEMA } },
    });
    const block = response.content.find((item) => item.type === "text");
    if (!block || block.type !== "text") throw new Error("TRIP_CANDIDATES_MISSING");
    return candidatesSchema.parse(JSON.parse(block.text)).candidates.slice(0, 20);
  } catch (error) {
    // A malformed or truncated response degrades to "no candidates found" (runTripPlan already has a plain message for that), never an
    // uncaught crash of the whole plan over one bad model response.
    reportFailure("trip_plan_extraction_failed", error, { version: TRIP_PLANNER_VERSION });
    return [];
  }
}

const itineraryDaySchema = z.object({ date: z.string(), label: z.string(), stops: z.array(z.object({ time: z.string(), name: z.string(), reason: z.string(), source: z.number() })) });
const itinerarySchema = z.object({ summary: z.string(), assumptions: z.array(z.string()), days: z.array(itineraryDaySchema), logistics: z.string(), caveat: z.string() });
export type Itinerary = z.infer<typeof itinerarySchema>;
const ITINERARY_JSON_SCHEMA = {
  type: "object", additionalProperties: false, required: ["summary", "assumptions", "days", "logistics", "caveat"],
  properties: {
    summary: { type: "string" },
    assumptions: { type: "array", items: { type: "string" } },
    days: { type: "array", items: {
      type: "object", additionalProperties: false, required: ["date", "label", "stops"],
      properties: {
        date: { type: "string" }, label: { type: "string" },
        stops: { type: "array", items: {
          type: "object", additionalProperties: false, required: ["time", "name", "reason", "source"],
          properties: { time: { type: "string" }, name: { type: "string" }, reason: { type: "string" }, source: { type: "number" } },
        } },
      },
    } },
    logistics: { type: "string" },
    caveat: { type: "string" },
  },
} as const;

function composerSystem(spec: TripSpec, sourceCount: number) {
  const days = [...Array(dayCount(spec)).keys()].map((offset) => spec.start.add({ days: offset }));
  const dayList = days.map((date) => `${date.toString()} (${date.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" })})`).join(", ");
  return `${DAYLARK_PERSONA}

You compose a day-by-day trip itinerary from real candidates already extracted from search evidence — you do not invent places, hours, prices or addresses beyond what a candidate's detail says. Trip: ${spec.destination}, ${dateRangeLabel(spec)}${spec.origin ? `, traveling from ${spec.origin}` : ""}, party of ${spec.partySize}${spec.partyStatus === "assumed" ? " (not stated — assumed)" : ""}, ${spec.pace} pace${spec.paceStatus === "assumed" ? " (not stated — assumed)" : ""}.

"days" must have exactly one entry per date, in order, for: ${dayList}. label is short ("Thu, Nov 26"). Each day gets 2 to 5 stops with a time (plain, "9:00 AM"), a name, a one-line reason naming the actual detail that earned its spot, and source (the candidate's source number — cite only numbers 1 to ${sourceCount}, never invent one). A dated candidate (dated: true) whose eventDateNote names a different year than ${spec.start.year} is NOT confirmed for this trip: either leave it out, or include it phrased as "if it repeats" and say so in assumptions, never as a settled plan.
${spec.commitments.length ? `\nThe traveler already has these calendar commitments during the trip window — work the itinerary around them, and call out in logistics or a stop's reason if a day is tighter because of one:\n${spec.commitments.join("\n")}\n` : ""}
summary: 2 to 3 sentences, what kind of trip this is and the headline reason to go, committing to a take rather than hedging.
assumptions: one short line per default you filled that was not actually said (dates aside, since a genuine date reading is not a guess) — party size, pace, and anything else.
logistics: 1 to 3 sentences of practical getting-around/getting-there guidance actually drawn from candidates or the drive estimate given; never invent flight numbers, transit schedules or prices not in the evidence.
caveat: one short line only when something matters (an event date isn't confirmed, hours may vary for the season), else "".

Voice: commit ("go with X"), specific details only, no filler adjectives (stunning, magical, must-see, hidden gem, world-class, unforgettable, iconic, perfect, amazing, incredible), no opener like "Here's your itinerary". Return JSON only.`;
}

async function composeItinerary(spec: TripSpec, candidates: Candidate[], sourceCount: number, driveNote: string | null, deps: TripPlannerDeps, repairNote?: string): Promise<Itinerary> {
  const evidence = candidates.map((candidate, index) => `${index + 1}. [${candidate.category}] ${candidate.name} — ${candidate.detail}${candidate.dated ? ` (dated: ${candidate.eventDateNote || "no year given"})` : ""} [source ${candidate.source}]`).join("\n");
  prepareAgentStage(["general"], "high");
  const compositionModel = configuredModel("high");
  const response = await deps.complete("trip_itinerary_composition", {
    model: compositionModel,
    // Up to ~5 days x 5 stops, each with a time, name and reason, plus summary/assumptions/logistics: the same truncation risk as
    // extraction's token cap, for the call whose output is the actual answer, so the margin matters even more here.
    max_tokens: 2400,
    ...(supportsTemperature(compositionModel) ? { temperature: 0 } : {}),
    system: composerSystem(spec, sourceCount),
    messages: [{ role: "user", content: `Candidates:\n${evidence}${driveNote ? `\n\nDrive estimate: ${driveNote}` : ""}${repairNote ? `\n\nYour previous attempt had problems — fix them: ${repairNote}` : ""}` }],
    output_config: { format: { type: "json_schema", schema: ITINERARY_JSON_SCHEMA } },
  });
  const block = response.content.find((item) => item.type === "text");
  if (!block || block.type !== "text") throw new Error("TRIP_ITINERARY_MISSING");
  return itinerarySchema.parse(JSON.parse(block.text));
}

/** Deterministic, never a second guess at what the itinerary should say (R20.6): only checks the shape it promised — the right number of
 * days, every day non-empty, every citation a real source. */
export function critiqueItinerary(itinerary: Itinerary, spec: TripSpec, sourceCount: number): string[] {
  const issues: string[] = [];
  const expected = dayCount(spec);
  if (itinerary.days.length !== expected) issues.push(`"days" must have exactly ${expected} entries, one per date from ${spec.start} up to (not including) ${spec.endExclusive}; it had ${itinerary.days.length}.`);
  for (const day of itinerary.days) {
    if (!day.stops.length) issues.push(`${day.label || day.date} has no stops; every day needs at least one.`);
    for (const stop of day.stops) {
      if (!Number.isInteger(stop.source) || stop.source < 1 || stop.source > sourceCount) issues.push(`"${stop.name}" cites source ${stop.source}, which is not one of the 1–${sourceCount} real sources given.`);
    }
  }
  return issues;
}

/** Code states the calendar outcome plainly every time — clear or not — the same way `schedule_feasibility` always says what it found,
 * never only when there happens to be a conflict (found live, R32: a silent check that only speaks up for a conflict reads, from the
 * outside, as no check having happened at all). Never asks the model to describe it: the calendar is real data, not a claim to phrase. */
function calendarNote(spec: TripSpec): string {
  return spec.commitments.length ? `You have commitments during this window: ${spec.commitments.join("; ")}.` : "Your calendar is clear for these dates.";
}

function renderItinerary(itinerary: Itinerary, spec: TripSpec, sources: Source[]): string {
  const lines: string[] = [`### ${spec.destination}, ${dateRangeLabel(spec)}`, itinerary.summary.trim()];
  const assumptions = itinerary.assumptions.map((line) => plain(line, 160)).filter(Boolean);
  if (assumptions.length) lines.push(`*Assumed: ${assumptions.join("; ")}*`);
  lines.push(`**Calendar:** ${calendarNote(spec)}`);
  for (const day of itinerary.days) {
    lines.push(`#### ${plain(day.label, 60) || day.date}`);
    const stops = day.stops.map((stop) => {
      const time = plain(stop.time, 20);
      const name = plain(stop.name, 80);
      if (!name) return "";
      const reason = plain(stop.reason, 160);
      const cite = Number.isInteger(stop.source) && stop.source >= 1 && stop.source <= sources.length ? ` [${stop.source}]` : "";
      return `- ${time ? `${time} — ` : ""}**${name}**${reason ? ` — ${reason}` : ""}${cite}`;
    }).filter(Boolean);
    lines.push(stops.join("\n"));
  }
  if (itinerary.logistics.trim()) lines.push(`**Getting there and around:** ${plain(itinerary.logistics, 400)}`);
  if (itinerary.caveat.trim()) lines.push(`*${plain(itinerary.caveat, 200)}*`);
  if (sources.length) lines.push(`### Sources\n${sources.map((source, index) => `- **${index + 1}** · [${plain(source.title, 120)}](${source.url})`).join("\n")}`);
  return lines.filter(Boolean).join("\n\n");
}

/** The whole pipeline: resolve the spec, research, extract, compose, check, repair once, render. Never the single-shot search-and-summarize
 * path (`agents/general.ts`) — a plan is a different job, not a longer answer to the same job. `deps` is required, never defaulted to the
 * real `callClaude`, so a live eval can inject a spend-metered raw call the same way `interpretTime` already does (see trip-planner-runtime.ts
 * for the production wiring, and trip-live.test.ts for the eval one). */
export async function runTripPlan(destination: string, dateText: string, userId: string, context: { role: "user" | "assistant"; content: string }[], deps: TripPlannerDeps): Promise<string> {
  extendRequestBudget(PLAN_BUDGET.totalMs, PLAN_BUDGET.costLimitUsd);
  const outcome = await buildTripSpec(destination, dateText, userId, context);
  if (outcome.kind === "unavailable") return TIME_UNAVAILABLE;
  if (outcome.kind === "ask") return askAboutTime(outcome.question, outcome.choices);
  const spec = outcome.spec;

  const [sources, driveNote] = await Promise.all([
    researchTrip(spec),
    spec.origin ? calculateDrivingRoute(spec.origin, spec.destination).then((route) => `About ${Math.round(route.durationMinutes / 60 * 10) / 10} hours' drive from ${spec.origin} (${route.distanceMeters ? `${Math.round(route.distanceMeters / 1609)} miles` : "distance unknown"}).`).catch(() => null) : Promise.resolve(null),
  ]);
  if (!sources.length) return `I couldn't find reliable current information about ${spec.destination} to plan around. Try again in a bit, or tell me specific things you'd like to see and I can look those up directly.`;

  const candidates = await extractCandidates(spec, sources, deps);
  if (!candidates.length) return `I found sources for ${spec.destination} but nothing specific enough to build stops from. Try a more specific destination, or ask me to search for particular things to do there.`;

  let itinerary: Itinerary;
  try {
    itinerary = await composeItinerary(spec, candidates, sources.length, driveNote, deps);
  } catch (error) {
    // A malformed or truncated response is not a shape problem `critiqueItinerary` can see (there is no itinerary to check yet) — it gets
    // the same one-repair-then-accept treatment, just with its own note, instead of crashing the whole plan over one bad response.
    reportFailure("trip_plan_composition_failed", error, { version: TRIP_PLANNER_VERSION });
    try {
      itinerary = await composeItinerary(spec, candidates, sources.length, driveNote, deps, "Your previous response could not be read as valid JSON — it may have run out of room. Keep every field valid, and keep the whole response within the token limit by using fewer or shorter stops if needed; never truncate mid-field.");
    } catch (retryError) {
      reportFailure("trip_plan_composition_failed_twice", retryError, { version: TRIP_PLANNER_VERSION });
      return `I ran into a problem putting that itinerary together. Please try again, or narrow the destination or dates.`;
    }
  }
  const issues = critiqueItinerary(itinerary, spec, sources.length);
  if (issues.length) {
    try {
      itinerary = await composeItinerary(spec, candidates, sources.length, driveNote, deps, issues.join(" "));
    } catch (error) {
      reportFailure("trip_plan_repair_failed", error, { version: TRIP_PLANNER_VERSION });
    }
    const remaining = critiqueItinerary(itinerary, spec, sources.length);
    if (remaining.length) reportFailure("trip_plan_unrepaired", new Error(remaining.join(" ")), { version: TRIP_PLANNER_VERSION });
  }
  return renderItinerary(itinerary, spec, sources);
}
