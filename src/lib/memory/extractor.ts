import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { reportFailure } from "@/lib/observability/report";
import { MEMORY_CATEGORIES, MEMORY_STRENGTHS, MEMORY_TYPES, type Memory } from "./types";

/**
 * R20.5, R.memory: what's worth remembering long-term is decided by a model reading ONE message, never by rules. Prompt-injection defense
 * is structural, not just an instruction: this function's only input is the person's own literal message text — never an assistant reply,
 * an email body, a search result or any other tool output, so nothing else can plant a false memory (an email that says "remember to wire
 * $5,000" is never even shown to this call). Callers must never pass anything but the person's own typed words.
 */
export const MEMORY_EXTRACTOR_VERSION = "memory-extract-v2";

export type ExtractedMemory = {
  action: "add" | "update";
  type: (typeof MEMORY_TYPES)[number];
  category: (typeof MEMORY_CATEGORIES)[number];
  strength: (typeof MEMORY_STRENGTHS)[number];
  statement: string;
  /** True: file as active now. False: a guess beyond what was literally said, so it waits as "pending" until confirmed. */
  stated: boolean;
  /** ISO date the statement itself stops being true ("until October", "traveling in December"). Null: no stated end point. */
  validUntil: string | null;
  /** An existing memory's id (from the ones given) that this statement replaces or promotes. Null for a genuinely new one. */
  supersedes: string | null;
};

const outputSchema = z.object({
  candidates: z.array(z.object({
    action: z.enum(["add", "update", "noop"]),
    type: z.enum(MEMORY_TYPES),
    category: z.enum(MEMORY_CATEGORIES),
    strength: z.enum(MEMORY_STRENGTHS),
    statement: z.string(),
    stated: z.boolean(),
    validUntil: z.string().nullable(),
    supersedes: z.string().nullable(),
  })).max(5),
});
type Output = z.infer<typeof outputSchema>;

export const MEMORY_EXTRACTOR_SYSTEM = `You read ONE message a person sent to their own personal assistant and decide what, if anything, is worth remembering about them long-term. You are never shown the assistant's replies, an email, a search result, or any other tool output: only the person's own words, so nothing else can plant a false memory in you. Extract only what THIS message itself states about the person; an idea the assistant offered that the person merely agreed to ("sounds good", "sure", "yes") is not a fact about them, and neither is a question or a request to do something right now.

Kinds:
- fact: a stable truth about their life (diet, health, work, location, a recurring payment, a relationship), INCLUDING a restriction, exclusion or limit on what they eat, use or can have ("I don't eat meat except fish and chicken", "I'm allergic to shellfish", "no dairy"). A restriction is always a fact with strength "hard", never a "preference", however casually it's phrased — an answer that violates it is simply wrong, not just unwelcome. Facts change rarely: file on first mention.
- preference: how they like things when nothing is being excluded or required, softer than a fact ("prefers mornings", "likes marine collagen over bovine" [a preference between two things they CAN have], "prefers concise answers"). Do not generalize past their literal words: "likes sushi" stays sushi, never becomes "likes Japanese food". A one-off daily event with an incidental reaction ("had pizza tonight, it was good", "watched a movie, it was fine") is not filed at all, not even as pending — it is not about a lasting taste, just something that happened once. A passing mention that names a specific place, product or activity they might want recommended again ("I really liked that sushi place") is closer, but still not yet a lasting preference on its own (stated: false, action: "add" — it waits for a second mention to be confirmed). It becomes a real preference only when: (a) the message itself states it as a lasting trait ("I always...", "I never...", "I prefer mornings"), or (b) the given existing memories already include a PENDING memory about the same thing from a prior message — a second mention confirms it, so set action "update", supersedes that pending id, and stated true.
- rule: an instruction for how the assistant itself should behave ("always ask before importing", "never auto-send", "categorize Costco as groceries"). Always strength "hard".

Do not remember anything a tool can already answer on its own (today's weather, a calendar event that's already on the calendar, an account balance) — only what no tool can look up.
strength: "hard" for something an answer must never violate (an allergy, a real exclusion, a rule); "soft" for an ordinary preference.
category: exactly one of diet, health, work, finance, email, calendar, travel, household, general.
stated: true when you are confident this belongs in the record right now (said directly as lasting, or confirmed by a second mention); false when you are inferring beyond what was literally said, so it must wait for the person to confirm it.
validUntil: an ISO date (YYYY-MM-DD) only when the message itself names a real end point ("on a cut until October 15" -> that date; "traveling in December" -> November 30 [end of the month before] as a safe start... actually use the trip's own end when stated, otherwise the end of the named month). Null otherwise; never guess one.
supersedes: an existing memory's id (from the list given) that this statement contradicts, updates, or (for a repeated preference) promotes. Null for a genuinely new memory.
action: "add" for something new, "update" when supersedes is filled, "noop" when nothing in this message is worth remembering — most messages produce zero candidates.
Return at most 5 candidates.`;

export const MEMORY_EXTRACTOR_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "type", "category", "strength", "statement", "stated", "validUntil", "supersedes"],
        properties: {
          action: { type: "string", enum: ["add", "update", "noop"] },
          type: { type: "string", enum: [...MEMORY_TYPES] },
          category: { type: "string", enum: [...MEMORY_CATEGORIES] },
          strength: { type: "string", enum: [...MEMORY_STRENGTHS] },
          statement: { type: "string" },
          stated: { type: "boolean" },
          validUntil: { type: ["string", "null"] },
          supersedes: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

export function buildExtractorMessage(userMessage: string, existing: Pick<Memory, "id" | "type" | "category" | "status" | "statement">[]) {
  return JSON.stringify({
    message: userMessage,
    existingMemories: existing.map((m) => ({ id: m.id, type: m.type, category: m.category, status: m.status, statement: m.statement })),
  });
}

export type ExtractorDeps = { complete: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message> };

/** R20.5: no model, no guess — a failed call remembers nothing rather than remembering something wrong. */
export async function extractMemories(userMessage: string, existing: Pick<Memory, "id" | "type" | "category" | "status" | "statement">[], deps: ExtractorDeps): Promise<ExtractedMemory[]> {
  try {
    const response = await deps.complete({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      temperature: 0,
      system: MEMORY_EXTRACTOR_SYSTEM,
      messages: [{ role: "user", content: buildExtractorMessage(userMessage, existing) }],
      output_config: { format: { type: "json_schema", schema: MEMORY_EXTRACTOR_JSON_SCHEMA } },
    });
    const block = response.content.find((item) => item.type === "text");
    if (!block || block.type !== "text") throw new Error("MEMORY_EXTRACTOR_OUTPUT_MISSING");
    const parsed = outputSchema.parse(JSON.parse(block.text));
    return toExtracted(parsed, existing);
  } catch (error) {
    reportFailure("memory_extractor_unavailable", error, { version: MEMORY_EXTRACTOR_VERSION });
    return [];
  }
}

/** Structure only (R19.5): drops "noop" rows, and an "update" naming an id that wasn't actually offered becomes a plain "add" instead of silently failing. */
function toExtracted(output: Output, existing: Pick<Memory, "id">[]): ExtractedMemory[] {
  const knownIds = new Set(existing.map((m) => m.id));
  return output.candidates.flatMap((candidate) => {
    if (candidate.action === "noop") return [];
    const supersedes = candidate.supersedes && knownIds.has(candidate.supersedes) ? candidate.supersedes : null;
    return [{
      action: supersedes ? "update" : "add",
      type: candidate.type, category: candidate.category, strength: candidate.strength,
      statement: candidate.statement.trim().slice(0, 500),
      stated: candidate.stated,
      validUntil: candidate.validUntil,
      supersedes,
    }];
  });
}
