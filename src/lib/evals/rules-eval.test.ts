import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { exclusionTerms, extractRequestedSender, fixDomainTypos, recencyDays, stripExclusions } from "@/lib/agents/email-query";
import { parseLearningsCommand } from "@/lib/learning/commands";
import { NO_LEARNINGS, applyLearnings, describeSearch } from "@/lib/learning/learnings";
import { detectCalendarPreference, detectFinanceCorrection } from "@/lib/learning/preferences";
import { parseEmailRequest, renderEmailRequest, type EmailRequest } from "@/lib/agents/email-request";
import { detectEmailIntent, emailIntentRelevance, minimumEmailRelevance } from "@/lib/agents/email-relevance";
import { documentScore, minimumDocumentScore } from "@/lib/agents/email-finance-import";
import { isEmailFinanceImport } from "@/lib/orchestrator/routing";

// Sender case is display-only (R2.2), so compare it case-insensitively.
function field(request: EmailRequest, key: keyof EmailRequest) {
  const value = request[key];
  return (key === "sender" || key === "exclusion") && typeof value === "string" ? value.toLowerCase() : value;
}
function wanted(key: string, value: unknown) {
  return (key === "sender" || key === "exclusion") && typeof value === "string" ? value.toLowerCase() : value;
}

function load<T>(name: string) {
  return readFileSync(resolve(process.cwd(), "evals", name), "utf8").trim().split("\n").map((line) => JSON.parse(line) as T);
}

type ParsingCase = { id: string; rule: string; input: string; expect: { intent?: string; sender?: string | null; recencyDays?: number | null; excluded?: string[]; mutation?: boolean; importRoute?: boolean } };
describe("rules: email parsing (evals/email-parsing.jsonl)", () => {
  for (const { id, rule, input, expect: want } of load<ParsingCase>("email-parsing.jsonl")) {
    it(`${id} [${rule}]`, () => {
      const fixed = fixDomainTypos(input);
      const sender = extractRequestedSender(fixed);
      if ("intent" in want) expect(detectEmailIntent(fixed)).toBe(want.intent);
      if ("sender" in want) expect(sender).toBe(want.sender);
      if ("recencyDays" in want) expect(recencyDays(stripExclusions(fixed).core)).toBe(want.recencyDays);
      if ("excluded" in want) expect(exclusionTerms(fixed, sender)).toEqual(want.excluded);
      if ("importRoute" in want) expect(isEmailFinanceImport(fixed)).toBe(want.importRoute);
    });
  }
});

type RelevanceCase = { id: string; rule: string; message: { subject: string; from: string; snippet: string }; accept: boolean };
describe("rules: what counts as a receipt (evals/email-relevance.jsonl)", () => {
  for (const { id, rule, message, accept } of load<RelevanceCase>("email-relevance.jsonl")) {
    it(`${id} [${rule}]`, () => {
      expect(emailIntentRelevance(message, "receipt") >= minimumEmailRelevance("receipt")).toBe(accept);
    });
  }
});

type FollowUpCase = { id: string; rule: string; state?: { request: EmailRequest; results: Array<{ id: string; subject: string; from: string; date: string }> }; context: Array<{ role: "user" | "assistant"; content: string }>; input: string; expect: Partial<EmailRequest> | null };
type ImportCase = { id: string; rule: string; input: string; message: { subject: string; snippet: string; from?: string }; accept: boolean };
describe("rules: import candidate scoring (evals/email-import.jsonl)", () => {
  for (const { id, rule, input, message, accept } of load<ImportCase>("email-import.jsonl")) {
    it(`${id} [${rule}]`, () => expect(documentScore(message, input) >= minimumDocumentScore(input)).toBe(accept));
  }
});

type VariantGroup = { id: string; rule: string; expect: Partial<EmailRequest>; variants: string[] };
describe("rules: the same request in many wordings (evals/email-variants.jsonl)", () => {
  for (const { id, rule, expect: want, variants } of load<VariantGroup>("email-variants.jsonl")) {
    describe(`${id} [${rule}]`, () => {
      for (const variant of variants) {
        it(variant, () => {
          const request = parseEmailRequest(variant);
          for (const [key, value] of Object.entries(want)) expect(field(request, key as keyof EmailRequest), key).toEqual(wanted(key, value));
        });
      }
    });
  }
});

describe("rules: a rendered request parses back to itself (R5.5)", () => {
  const requests: EmailRequest[] = [
    { action: "list", topic: "receipt", sender: "iherb", days: 30, calendar: null, unread: false, humansOnly: false, exclusion: "" },
    { action: "list", topic: "promotion", sender: null, days: null, calendar: "this week", unread: true, humansOnly: false, exclusion: "" },
    { action: "list", topic: "general", sender: "Amazon Web Services", days: null, calendar: "today", unread: false, humansOnly: false, exclusion: "not regular Amazon?" },
    { action: "list", topic: "recruiter", sender: null, days: 7, calendar: null, unread: true, humansOnly: false, exclusion: "" },
    { action: "list", topic: "general", sender: "Google", days: null, calendar: "yesterday", unread: false, humansOnly: true, exclusion: "" },
    { action: "facts", topic: "receipt", sender: "Adobe", days: 30, calendar: null, unread: false, humansOnly: false, exclusion: "" },
    { action: "import_all", topic: "receipt", sender: "iherb", days: 30, calendar: null, unread: false, humansOnly: false, exclusion: "" },
    { action: "import", topic: "receipt", sender: "Amazon Web Services", days: null, calendar: null, unread: false, humansOnly: false, exclusion: "" },
  ];
  for (const request of requests) {
    it(renderEmailRequest(request), () => expect(parseEmailRequest(renderEmailRequest(request))).toEqual(request));
  }
});

type TermsCase = { id: string; rule: string; input: string; expect: string };
describe("rules: the search terms shown to the user (evals/email-terms.jsonl)", () => {
  for (const { id, rule, input, expect: want } of load<TermsCase>("email-terms.jsonl")) {
    it(`${id} [${rule}]`, () => {
      const { request, defaultedWindow } = applyLearnings(parseEmailRequest(input), NO_LEARNINGS);
      expect(describeSearch(request, defaultedWindow)).toBe(want);
    });
  }
});

type OrdinalCase = { id: string; rule: string; input: string; results: Array<{ date: string }>; expect: unknown };
type CommandCase = { id: string; rule: string; input: string; expect: unknown };
describe("rules: viewing and forgetting (evals/learning-commands.jsonl)", () => {
  for (const { id, rule, input, expect: want } of load<CommandCase>("learning-commands.jsonl")) {
    it(`${id} [${rule}]`, () => expect(parseLearningsCommand(input)).toEqual(want));
  }
});

describe("rules: calendar and finance corrections (evals/preferences.jsonl)", () => {
  for (const { id, rule, input, expect: want } of load<CommandCase>("preferences.jsonl")) {
    it(`${id} [${rule}]`, () => expect(detectCalendarPreference(input) ?? detectFinanceCorrection(input)).toEqual(want));
  }
});
