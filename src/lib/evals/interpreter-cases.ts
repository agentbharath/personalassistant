import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Interpretation, InterpreterInput } from "@/lib/agents/email-interpreter";
import type { EmailRequest } from "@/lib/agents/email-request";
import type { EmailState } from "@/lib/conversations/email-state";

export type InterpreterCase = {
  label: string;
  input: InterpreterInput;
  /** `pick` is the numbered result the message points at (null for none); `asks` means it must come back as a question rather than an action. */
  expect: Partial<EmailRequest> & { domain?: "email" | "other"; pick?: { index: number; action: "show" | "facts" | "import" } | null; asks?: true };
};

function load<T>(name: string) {
  return readFileSync(resolve(process.cwd(), "evals", name), "utf8").trim().split("\n").map((line) => JSON.parse(line) as T);
}

const same = (value: unknown) => (typeof value === "string" ? value.toLowerCase().replace(/[.?!]+$/, "").trim() : value);

export function checkInterpretation(result: Interpretation, want: InterpreterCase["expect"]) {
  const failures: string[] = [];
  for (const [key, value] of Object.entries(want)) {
    if (key === "asks") { if (!result.clarification || result.pick) failures.push("wanted a question, not an action"); continue; }
    const got = key === "domain" ? result.domain : key === "pick" ? result.pick : result.request[key as keyof EmailRequest];
    if (JSON.stringify(same(got)) !== JSON.stringify(same(value))) failures.push(`${key}: wanted ${JSON.stringify(value)}, got ${JSON.stringify(got)}`);
  }
  return failures;
}

/** Every email eval row that is an interpreter case, built from the datasets. Appending a row to a dataset adds a case here. */
export function buildInterpreterCases(): InterpreterCase[] {
  const cases: InterpreterCase[] = [];
  const base = (message: string, state: EmailState | null = null): InterpreterInput => ({ userId: "live-eval", message, state, context: [] });

  for (const group of load<{ id: string; expect: Partial<EmailRequest>; variants: string[] }>("email-variants.jsonl")) {
    for (const variant of group.variants) cases.push({ label: `${group.id}: ${variant}`, input: base(variant), expect: { domain: "email", ...group.expect } });
  }
  for (const row of load<{ id: string; input: string; expect: { intent?: string; sender?: string | null; recencyDays?: number | null; importRoute?: boolean; mutation?: boolean } }>("email-parsing.jsonl")) {
    const want: InterpreterCase["expect"] = { domain: "email" };
    if ("intent" in row.expect) want.topic = row.expect.intent as EmailRequest["topic"];
    if ("sender" in row.expect) want.sender = row.expect.sender;
    if ("recencyDays" in row.expect) want.days = row.expect.recencyDays;
    // Email writes are declined before the interpreter runs, so they are not interpreter cases.
    if (row.expect.importRoute || "mutation" in row.expect) continue;
    cases.push({ label: `parsing: ${row.id}`, input: base(row.input), expect: want });
  }
  for (const row of load<{ id: string; state?: { request: EmailRequest; results: EmailState["results"] }; input: string; expect: Partial<EmailRequest> | null }>("email-followups.jsonl")) {
    if (!row.state || row.expect === null) continue;
    cases.push({ label: `follow-up: ${row.id}`, input: base(row.input, { ...row.state, updatedAt: 1 }), expect: { domain: "email", ...row.expect } });
  }
  // R13: pointing at a numbered result is read by the model too (R20.5). An out-of-range number is not asked of the model.
  type OrdinalRow = { id: string; input: string; results: Array<{ date: string }>; expect: { action?: "show" | "facts" | "import"; index?: number; ask?: string; outOfRange?: number } | null };
  for (const row of load<OrdinalRow>("email-ordinals.jsonl")) {
    if (row.expect && "outOfRange" in row.expect) continue;
    const results = row.results.map((item, index) => ({ id: `m${index + 1}`, subject: `Order Confirmed #${947597212 - index * 1000}`, from: "iHerb <noreply@info.iherb.com>", date: item.date }));
    const listed: EmailState = { request: { action: "list", topic: "receipt", sender: "iherb", days: null, calendar: null, unread: false, humansOnly: false, exclusion: "" }, results, updatedAt: 1 };
    const want: InterpreterCase["expect"] = row.expect === null ? { pick: null } : "ask" in row.expect ? { asks: true } : { pick: { index: row.expect.index!, action: row.expect.action! } };
    cases.push({ label: `ordinal: ${row.id}`, input: base(row.input, listed), expect: want });
  }
  const state: EmailState = { request: { action: "list", topic: "receipt", sender: "iherb", days: null, calendar: null, unread: false, humansOnly: false, exclusion: "" }, results: [], updatedAt: 1 };
  for (const message of ["what's on my calendar tomorrow", "how much did I spend on groceries this month", "best pizza near me", "cancel my 2 PM meeting"]) {
    cases.push({ label: `not email: ${message}`, input: base(message, state), expect: { domain: "other" } });
  }
  return cases;
}
