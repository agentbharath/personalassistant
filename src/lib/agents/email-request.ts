import { isEmailFinanceImport } from "@/lib/orchestrator/routing";
import { asksForInvoiceFacts } from "./email-invoice";
import { PERIOD_PATTERN, extractRequestedSender, fixDomainTypos, recencyDays, stripExclusions } from "./email-query";
import { detectEmailIntent, type EmailIntent } from "./email-relevance";

/** Everything Daylark understands about an email request, parsed once. Follow-ups edit these fields instead of rewriting sentences. */
export type EmailRequest = {
  action: "list" | "facts" | "amounts" | "import" | "import_all";
  topic: EmailIntent;
  sender: string | null;
  /** Rolling window in days ("last 30 days"), or null. */
  days: number | null;
  /** Calendar window, or null. */
  calendar: "today" | "yesterday" | "this week" | null;
  unread: boolean;
  humansOnly: boolean;
  /** The trailing exclusion clause, verbatim ("not regular Amazon"), or "". */
  exclusion: string;
};

export const HUMANS_ONLY = /\b(real (?:people|person|humans?)|actual (?:people|person)|not automated|no automated|personal emails?)\b/i;
export const EMAIL_NOUNS = /\b(?:emails?|mails?|inbox|gmail|messages?)\b/i;

const PLURAL_DOCUMENTS = /\b(?:receipts|invoices|orders|statements|amounts|totals)\b/i;
const PERIODS = new RegExp(PERIOD_PATTERN, "gi");
const SINGLE_OUT = /\b(?:latest|most recent|newest|last)\b/i;

/** R11.7: "all"/"every"/"each" asks for everything, not the default window. */
export function mentionsAll(input: string) {
  return /\b(?:all|every|each|everything)\b/i.test(stripExclusions(input).core);
}

export function parseEmailRequest(raw: string): EmailRequest {
  const input = fixDomainTypos(raw);
  const { core, clause } = stripExclusions(input);
  const topic = detectEmailIntent(input);
  const importing = isEmailFinanceImport(input);
  return {
    action: importing ? (/\b(?:all|every|each)\b/i.test(input) ? "import_all" : "import") : topic === "receipt" && asksForInvoiceFacts(core) ? (PLURAL_DOCUMENTS.test(core) && !SINGLE_OUT.test(core.replace(PERIODS, " ")) ? "amounts" : "facts") : "list",
    topic,
    sender: extractRequestedSender(input),
    days: recencyDays(core),
    calendar: (core.match(/\b(today|yesterday|this week)\b/i)?.[1]?.toLowerCase() as EmailRequest["calendar"]) ?? null,
    unread: /\bunread\b/i.test(core),
    humansOnly: HUMANS_ONLY.test(input),
    exclusion: clause,
  };
}

const TOPIC_NOUN: Record<EmailIntent, string> = { receipt: "receipt", promotion: "promotional", recruiter: "recruiter", general: "" };

/** Canonical sentence for a request. parseEmailRequest(renderEmailRequest(r)) must equal r (tested). */
export function renderEmailRequest(request: EmailRequest) {
  const from = request.sender ? `from ${request.sender}` : "";
  const window = request.days ? `last ${request.days} days` : request.calendar ?? "";
  const noun = TOPIC_NOUN[request.topic];
  let head: string;
  let tail = [window, request.unread ? "unread" : ""];
  if (request.action === "import_all") head = `Import all receipts ${from}`;
  else if (request.action === "import") head = `Import my latest receipt ${from}`;
  else if (request.action === "amounts") head = `Show the amounts on my receipts ${from}`;
  else if (request.action === "facts") { head = `Find the latest invoice ${from} ${window} and tell me the amount and billing date`; tail = [request.unread ? "unread" : ""]; }
  else { head = `Find ${request.unread ? "unread " : ""}${noun ? `${noun} ` : ""}emails ${from}`; tail = [window]; }
  const sentence = [head, ...tail, request.humansOnly ? "only real people" : ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return request.exclusion ? `${sentence}, ${request.exclusion}` : sentence;
}
