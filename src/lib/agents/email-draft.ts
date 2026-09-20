import type { RouterDecision } from "@/lib/orchestrator/router";
import type { DraftPayload } from "@/lib/drafts/payload";
import type { DraftSpec } from "@/lib/drafts/mime";
import { formatPerson, lookupPerson, parsePeople, searchTerm, type Person } from "@/lib/drafts/people";
import { draftsEnabled, latestDraft } from "@/lib/drafts/service";
import { writeDraftForUser } from "@/lib/drafts/writer-runtime";
import type { WriterInput } from "@/lib/drafts/writer";
import { GoogleConnectionRequiredError } from "@/lib/auth/google-credential-broker";
import { GoogleGmailAccessError, readGmailMessage, searchGmail, type EmailContent, type EmailSearchResult } from "@/lib/tools/email/google-gmail";
import type { EmailState } from "@/lib/conversations/email-state";
import { createDraftApproval, pendingDraftPayload, resolvePendingEmailDraft } from "@/lib/workflows/email-draft";

export type DraftIntent = NonNullable<RouterDecision["draft"]>;
/** The router's fields with the empty ones as "", so the rest of the code reads plain text. */
type Intent = { action: DraftIntent["action"]; kind: DraftIntent["kind"]; to: string; replyTo: string; instruction: string; version: string };
export type DraftReply = { answer: string; status: "completed" | "waiting_for_user"; choices?: string[] };

export const DRAFTS_NOT_AVAILABLE = "I can't save email drafts right now. I can summarise an email so you can write the reply yourself.";
const NEEDS_CONVERSATION = "I need a saved conversation before I can prepare a draft. Please start a new chat and try again.";
const NO_DRAFT = "I don't have a draft from this chat to change. Want me to write one? Tell me who it's for and what it should say.";
const WRITER_DOWN = "I couldn't write that draft just now, so nothing was saved. Please try again in a moment.";
export const DRAFT_RECONNECT = "To save drafts I need permission to write drafts to your Gmail. Open Settings, then Connections, choose Reconnect Google and approve drafts. I can never send email, with or without that permission. Nothing was saved.";

export type DraftContext = { userId: string; conversationId?: string; ownerName: string | null; ownerEmail: string | null; emailState: EmailState | null };
export type DraftDeps = {
  enabled: () => boolean;
  search: (userId: string, query: string, max: number) => Promise<EmailSearchResult[]>;
  read: (userId: string, messageId: string) => Promise<EmailContent>;
  write: typeof writeDraftForUser;
  latest: typeof latestDraft;
  approve: (userId: string, conversationId: string, payload: DraftPayload) => Promise<void>;
  /** The preview waiting for Confirm, and a way to drop it. */
  pending: (userId: string, conversationId: string) => Promise<DraftPayload | null>;
  cancelPending: (userId: string, conversationId: string) => Promise<unknown>;
};
const defaults: DraftDeps = { enabled: draftsEnabled, search: searchGmail, read: readGmailMessage, write: writeDraftForUser, latest: latestDraft, approve: createDraftApproval, pending: pendingDraftPayload, cancelPending: (userId, conversationId) => resolvePendingEmailDraft(userId, conversationId, "cancel") };

const quote = (text: string) => text.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n");
const day = (date: string) => { const parsed = Date.parse(date); return Number.isNaN(parsed) ? "" : new Date(parsed).toLocaleDateString("en-US", { month: "short", day: "numeric" }); };

const FOOTER = "I'll save this in your Gmail Drafts. **Nothing is sent**: you read it and send it yourself. Choose **Confirm** to save it or **Cancel**, or tell me what to change first (for example “make it shorter”).";

function preview(title: string, lines: string[], body: string) {
  return `### ${title}\n\n${lines.join("  \n")}\n\n${quote(body)}\n\n${FOOTER}`;
}

/** "Go back to the first version", "undo that": the router says "first", "previous", or a number. Anything else asks. */
export function pickVersion(version: string, count: number): number | null {
  if (count < 2) return null;
  const label = version.trim().toLowerCase();
  if (/^\d+$/.test(label)) { const index = Number(label) - 1; return index >= 0 && index < count ? index : null; }
  if (label === "first" || label === "original") return 0;
  if (label === "previous" || label === "last" || label === "") return count - 2;
  return null;
}

const ask = (answer: string, choices?: string[]): DraftReply => ({ answer, status: "waiting_for_user", ...(choices?.length ? { choices } : {}) });

/** R25: turns what the router read into a preview and a pending approval. Nothing is written to Gmail here; that happens only after Confirm. */
export async function prepareEmailDraft(raw: DraftIntent, ctx: DraftContext, deps: DraftDeps = defaults): Promise<DraftReply> {
  const intent: Intent = { action: raw.action, kind: raw.kind, to: raw.to ?? "", replyTo: raw.replyTo ?? "", instruction: raw.instruction ?? "", version: raw.version ?? "" };
  if (!deps.enabled()) return { answer: DRAFTS_NOT_AVAILABLE, status: "completed" };
  if (!ctx.conversationId) return ask(NEEDS_CONVERSATION);
  const conversationId = ctx.conversationId;
  try {
    if (intent.action === "create") return intent.kind === "reply" ? await prepareReply(intent, ctx, conversationId, deps) : await prepareNew(intent, ctx, conversationId, deps);
    // A preview that is still waiting for Confirm is the draft "this" means: changing it rewrites the preview, and nothing has been saved yet.
    const waiting = await deps.pending(ctx.userId, conversationId);
    if (waiting && waiting.action !== "discard" && waiting.action !== "revert") return await changeWaiting(intent, waiting, ctx, conversationId, deps);
    const current = await deps.latest(ctx.userId, conversationId);
    if (!current) return ask(NO_DRAFT);
    const last = current.versions.at(-1)!;
    if (intent.action === "discard") {
      await deps.approve(ctx.userId, conversationId, { action: "discard", draftId: current.id });
      return ask(`### Delete this draft?\n\nThis removes “${last.subject}” from your Gmail Drafts. Nothing has been sent.\n\nChoose **Confirm** to delete it or **Cancel** to keep it.`);
    }
    if (intent.action === "revert") {
      const index = pickVersion(intent.version, current.versions.length);
      if (index === null) return ask(current.versions.length < 2 ? "This draft has only one version, so there is nothing to go back to." : `Which version? This draft has ${current.versions.length}. Say “the first one” or “the previous one”.`, current.versions.length >= 2 ? ["The first version", "The previous version"] : undefined);
      const target = current.versions[index];
      await deps.approve(ctx.userId, conversationId, { action: "revert", draftId: current.id, versionIndex: index });
      return ask(preview(`Go back to version ${index + 1}`, [`**To:** ${target.to.join(", ")}`, `**Subject:** ${target.subject}`], target.body).replace("I'll save this in your Gmail Drafts.", "I'll put this wording back into the same Gmail draft."));
    }
    // edit
    if (!intent.instruction.trim()) return ask("What would you like to change?");
    const written = await deps.write(ctx.userId, { kind: "edit", instruction: intent.instruction, ownerName: ctx.ownerName, current: { subject: last.subject, body: last.body } });
    if (!written) return ask(WRITER_DOWN);
    await deps.approve(ctx.userId, conversationId, { action: "edit", draftId: current.id, subject: written.subject, body: written.body });
    return ask(preview("Changed draft — not sent", [`**To:** ${last.to.join(", ")}`, `**Subject:** ${written.subject}`], written.body).replace("I'll save this in your Gmail Drafts.", "I'll update the same Gmail draft."));
  } catch (error) {
    if (error instanceof GoogleConnectionRequiredError || (error instanceof GoogleGmailAccessError && error.reason === "insufficient_scope")) return ask(DRAFT_RECONNECT);
    throw error;
  }
}

/** Edit or scrap the preview that is still waiting. A new preview replaces it, so Confirm saves the latest wording. */
async function changeWaiting(intent: Intent, waiting: DraftPayload, ctx: DraftContext, conversationId: string, deps: DraftDeps): Promise<DraftReply> {
  if (intent.action === "discard") {
    await deps.cancelPending(ctx.userId, conversationId);
    return { answer: "Scrapped that draft. Nothing was saved or sent.", status: "completed" };
  }
  if (intent.action === "revert") return ask("Nothing has been saved yet, so there is no earlier version to go back to. Tell me what to change, or choose **Cancel**.");
  if (!intent.instruction.trim()) return ask("What would you like to change?");
  const current = waiting.action === "create" ? { subject: waiting.spec.subject, body: waiting.spec.body } : waiting.action === "edit" ? { subject: waiting.subject, body: waiting.body } : null;
  if (!current) return ask(NO_DRAFT);
  const written = await deps.write(ctx.userId, { kind: "edit", instruction: intent.instruction, ownerName: ctx.ownerName, current });
  if (!written) return ask(WRITER_DOWN);
  if (waiting.action === "create") {
    const spec: DraftSpec = { ...waiting.spec, subject: written.subject, body: written.body };
    await deps.approve(ctx.userId, conversationId, { action: "create", spec });
    return ask(preview(spec.inReplyTo ? "Draft reply — not sent" : "Draft email — not sent", [`**To:** ${spec.to.join(", ")}`, `**Subject:** ${spec.subject}`], spec.body));
  }
  await deps.approve(ctx.userId, conversationId, { action: "edit", draftId: waiting.draftId, subject: written.subject, body: written.body });
  return ask(preview("Changed draft — not sent", [`**Subject:** ${written.subject}`], written.body).replace("I'll save this in your Gmail Drafts.", "I'll update the same Gmail draft."));
}

async function prepareNew(intent: Intent, ctx: DraftContext, conversationId: string, deps: DraftDeps): Promise<DraftReply> {
  if (!intent.to.trim()) return ask("Who is it for?");
  if (!intent.instruction.trim()) return ask("What should the email say?");
  const direct = parsePeople(intent.to)[0] ?? (intent.to.includes("@") ? null : undefined);
  let recipient: Person | undefined = direct ?? undefined;
  if (!recipient) {
    const term = searchTerm(intent.to);
    const found = term ? await deps.search(ctx.userId, `(from:(${term}) OR to:(${term}))`, 25) : [];
    const lookup = lookupPerson(intent.to, found, ctx.ownerEmail);
    if (lookup.status === "none") return ask(`I couldn't find an email address for “${intent.to}” in your mail. What's their address?`);
    if (lookup.status === "many") return ask(`Which ${intent.to} do you mean?`, lookup.options.map((person) => `Write to ${person.address}`));
    recipient = lookup.person;
  }
  const written = await deps.write(ctx.userId, { kind: "new", instruction: intent.instruction, ownerName: ctx.ownerName, recipient: recipient.name || recipient.address });
  if (!written) return ask(WRITER_DOWN);
  const spec: DraftSpec = { to: [recipient.address], subject: written.subject, body: written.body };
  await deps.approve(ctx.userId, conversationId, { action: "create", spec });
  return ask(preview("Draft email — not sent", [`**To:** ${formatPerson(recipient)}`, `**Subject:** ${spec.subject}`], spec.body));
}

const reSubject = (subject: string) => (/^\s*re:/i.test(subject) ? subject.trim() : `Re: ${subject.trim() || "(no subject)"}`);

async function prepareReply(intent: Intent, ctx: DraftContext, conversationId: string, deps: DraftDeps): Promise<DraftReply> {
  if (!intent.instruction.trim()) return ask("What should the reply say?");
  const target = await findReplyTarget(intent, ctx, deps);
  if ("ask" in target) return ask(target.ask, target.choices);
  const original = await deps.read(ctx.userId, target.messageId);
  const recipient = parsePeople(original.reply.replyTo)[0] ?? parsePeople(original.from)[0];
  if (!recipient) return ask("I couldn't work out who to reply to on that email. Who should it go to?");
  const written = await deps.write(ctx.userId, { kind: "reply", instruction: intent.instruction, ownerName: ctx.ownerName, original: { from: original.from, subject: original.subject, date: original.date, text: original.text } } as WriterInput);
  if (!written) return ask(WRITER_DOWN);
  const spec: DraftSpec = {
    to: [recipient.address],
    subject: reSubject(original.subject),
    body: written.body,
    ...(original.reply.messageId ? { inReplyTo: { messageId: original.reply.messageId, references: original.reply.references, threadId: original.threadId } } : {}),
  };
  await deps.approve(ctx.userId, conversationId, { action: "create", spec });
  return ask(preview("Draft reply — not sent", [`**To:** ${formatPerson(recipient)}`, `**Subject:** ${spec.subject}`, `_Replying to “${original.subject}” from ${original.from.replace(/<[^>]*>/, "").trim() || original.from}${day(original.date) ? `, ${day(original.date)}` : ""}_`], spec.body));
}

async function findReplyTarget(intent: Intent, ctx: DraftContext, deps: DraftDeps): Promise<{ messageId: string } | { ask: string; choices?: string[] }> {
  const results = ctx.emailState?.results ?? [];
  // The router gives a number ("2") when the person pointed at a result of the last email search.
  const pointed = /^\d{1,2}$/.test(intent.replyTo.trim()) ? results[Number(intent.replyTo.trim()) - 1] : undefined;
  if (pointed) return { messageId: pointed.id };
  if (intent.to.trim()) {
    const term = searchTerm(intent.to);
    const found = term ? await deps.search(ctx.userId, `in:inbox from:(${term})`, 15) : [];
    const lookup = lookupPerson(intent.to, found, ctx.ownerEmail);
    if (lookup.status === "none") return { ask: `I couldn't find a recent email from “${intent.to}”. Which email should I reply to? Tell me who it's from or what it's about.` };
    if (lookup.status === "many") return { ask: `Which ${intent.to} do you mean?`, choices: lookup.options.map((person) => `Reply to ${person.address}`) };
    const newest = found.filter((message) => parsePeople(message.from).some((person) => person.address === lookup.person.address)).sort((left, right) => right.receivedAt - left.receivedAt)[0];
    return newest ? { messageId: newest.id } : { ask: `I couldn't find a recent email from ${lookup.person.address}. Which email should I reply to?` };
  }
  if (results.length === 1) return { messageId: results[0].id };
  if (results.length > 1) return { ask: "Which email should I reply to? Say a number from 1 to " + results.length + ".", choices: results.slice(0, 8).map((_, index) => String(index + 1)) };
  return { ask: "Which email should I reply to? Tell me who it's from or what it's about." };
}
