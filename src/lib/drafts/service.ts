import { decryptText, encryptText } from "@/lib/security/encryption";
import { createAdminClient } from "@/lib/supabase/admin";
import { GmailDraftMissingError, createGmailDraft, deleteGmailDraft, draftBodyText, getGmailDraft, updateGmailDraft } from "@/lib/tools/email/gmail-drafts";
import { buildRawMessage, normalizeBody, type DraftSpec } from "./mime";

/** Drafting is off until the owner enables it (R25). Nothing here runs, and no permission beyond read-only is requested, while it is off. */
export const draftsEnabled = () => process.env.DRAFTS_ENABLED === "true";
export class DraftsDisabledError extends Error {}
export class DraftNotFoundError extends Error {}

export type DraftVersion = { at: string; body: string; subject: string; to: string[]; cc: string[]; note: string };
type Row = { id: string; gmail_draft_id: string; gmail_thread_id: string | null; versions_ciphertext: string | null };

/** What a change to a draft came to. `conflict` means the person edited the draft in Gmail after Daylark's last version, and nothing was changed. */
export type ChangeResult =
  | { status: "ok"; versionIndex: number }
  | { status: "conflict"; liveBody: string }
  | { status: "gone" };

function requireEnabled() { if (!draftsEnabled()) throw new DraftsDisabledError("Email drafting is not enabled"); }

const table = () => createAdminClient().from("email_drafts");
const readVersions = (row: Row): DraftVersion[] => (row.versions_ciphertext ? JSON.parse(decryptText(row.versions_ciphertext)) as DraftVersion[] : []);
const sealVersions = (versions: DraftVersion[]) => encryptText(JSON.stringify(versions));

/** Only a draft Daylark created, found by its own record, is ever touched. A Gmail draft id from anywhere else is never accepted. */
async function ownedDraft(userId: string, id: string): Promise<Row> {
  const { data, error } = await table().select("id, gmail_draft_id, gmail_thread_id, versions_ciphertext").eq("id", id).eq("user_id", userId).is("discarded_at", null).maybeSingle();
  if (error) throw error;
  if (!data) throw new DraftNotFoundError("No such draft");
  return data as Row;
}

async function markGone(userId: string, row: Row) {
  await table().update({ discarded_at: new Date().toISOString(), versions_ciphertext: null, updated_at: new Date().toISOString() }).eq("id", row.id).eq("user_id", userId);
}

const asVersion = (spec: { subject: string; body: string; to: string[]; cc?: string[] }, note: string): DraftVersion => ({ at: new Date().toISOString(), body: spec.body, subject: spec.subject, to: spec.to, cc: spec.cc ?? [], note });

/** Creates a draft in the person's Gmail Drafts folder. It is not sent, and cannot be sent from here. */
export async function createDraft(userId: string, conversationId: string | null, spec: DraftSpec): Promise<{ id: string; versionIndex: number }> {
  requireEnabled();
  const raw = buildRawMessage(spec); // throws on anything malformed, before any network call
  const created = await createGmailDraft(userId, { raw, threadId: spec.inReplyTo?.threadId });
  const versions = [asVersion(spec, "created")];
  const { data, error } = await table().insert({
    user_id: userId,
    conversation_id: conversationId,
    gmail_draft_id: created.id,
    gmail_thread_id: created.message?.threadId ?? spec.inReplyTo?.threadId ?? null,
    versions_ciphertext: sealVersions(versions),
  }).select("id").single();
  if (error || !data) {
    // Do not leave a draft in Gmail that Daylark has no record of.
    await deleteGmailDraft(userId, created.id).catch(() => undefined);
    throw error ?? new Error("DRAFT_RECORD_FAILED");
  }
  return { id: data.id as string, versionIndex: 0 };
}

/** Writes new content into a draft, unless the person changed it in Gmail (then it stops and says so, or keeps their edit as a version first). */
async function writeVersion(userId: string, row: Row, next: { subject: string; body: string; to: string[]; cc?: string[] }, note: string, options: { keepLive?: boolean }): Promise<ChangeResult> {
  const versions = readVersions(row);
  const last = versions.at(-1);
  let live: string;
  try { live = draftBodyText(await getGmailDraft(userId, row.gmail_draft_id)); }
  catch (error) { if (error instanceof GmailDraftMissingError) { await markGone(userId, row); return { status: "gone" }; } throw error; }

  if (last && normalizeBody(live) !== normalizeBody(last.body)) {
    if (!options.keepLive) return { status: "conflict", liveBody: live };
    versions.push({ ...last, at: new Date().toISOString(), body: live, note: "your edit in Gmail" });
  }

  const raw = buildRawMessage(next);
  try { await updateGmailDraft(userId, row.gmail_draft_id, { raw, threadId: row.gmail_thread_id ?? undefined }); }
  catch (error) { if (error instanceof GmailDraftMissingError) { await markGone(userId, row); return { status: "gone" }; } throw error; }

  versions.push(asVersion(next, note));
  await table().update({ versions_ciphertext: sealVersions(versions), updated_at: new Date().toISOString() }).eq("id", row.id).eq("user_id", userId);
  return { status: "ok", versionIndex: versions.length - 1 };
}

export async function editDraft(userId: string, id: string, changes: { body: string; subject?: string; to?: string[]; cc?: string[] }, options: { keepLive?: boolean } = {}): Promise<ChangeResult> {
  requireEnabled();
  const row = await ownedDraft(userId, id);
  const last = readVersions(row).at(-1);
  if (!last) throw new DraftNotFoundError("Draft has no saved version");
  return writeVersion(userId, row, { subject: changes.subject ?? last.subject, body: changes.body, to: changes.to ?? last.to, cc: changes.cc ?? last.cc }, "edited", options);
}

/** "Go back to the first version": writes a saved version back into the same draft. The restore is itself saved as a new version. */
export async function revertDraft(userId: string, id: string, versionIndex: number, options: { keepLive?: boolean } = {}): Promise<ChangeResult> {
  requireEnabled();
  const row = await ownedDraft(userId, id);
  const target = readVersions(row)[versionIndex];
  if (!target) throw new DraftNotFoundError("No such version");
  return writeVersion(userId, row, target, `restored version ${versionIndex + 1}`, options);
}

/** Deletes the draft from Gmail and drops its saved versions (R25.8). A draft the person edited in Gmail needs `force`. */
export async function discardDraft(userId: string, id: string, options: { force?: boolean } = {}): Promise<{ status: "discarded" } | { status: "conflict"; liveBody: string } | { status: "gone" }> {
  requireEnabled();
  const row = await ownedDraft(userId, id);
  const last = readVersions(row).at(-1);
  try {
    const live = draftBodyText(await getGmailDraft(userId, row.gmail_draft_id));
    if (last && !options.force && normalizeBody(live) !== normalizeBody(last.body)) return { status: "conflict", liveBody: live };
    await deleteGmailDraft(userId, row.gmail_draft_id);
  } catch (error) {
    if (error instanceof GmailDraftMissingError) { await markGone(userId, row); return { status: "gone" }; }
    throw error;
  }
  await markGone(userId, row);
  return { status: "discarded" };
}

export async function listVersions(userId: string, id: string) {
  requireEnabled();
  return readVersions(await ownedDraft(userId, id)).map((version, index) => ({ index, at: version.at, note: version.note, subject: version.subject, preview: version.body.replace(/\s+/g, " ").slice(0, 80) }));
}

/** The newest draft Daylark saved in this conversation that is still in Gmail, with its versions. "Make it shorter" means this one. */
export async function latestDraft(userId: string, conversationId: string) {
  requireEnabled();
  const { data, error } = await table().select("id, gmail_draft_id, gmail_thread_id, versions_ciphertext").eq("user_id", userId).eq("conversation_id", conversationId).is("discarded_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const versions = readVersions(data as Row);
  return versions.length ? { id: data.id as string, versions } : null;
}

export type ExistingDraft = { id: string; subject: string };

/** Drafts Daylark saved on this Gmail thread that are still in Gmail. Only Daylark's own record is read: other drafts in the mailbox are never listed. */
export async function draftsOnThread(userId: string, threadId: string): Promise<ExistingDraft[]> {
  requireEnabled();
  const { data, error } = await table().select("id, gmail_draft_id, gmail_thread_id, versions_ciphertext").eq("user_id", userId).eq("gmail_thread_id", threadId).is("discarded_at", null).order("created_at", { ascending: false }).limit(3);
  if (error) throw error;
  return (data ?? []).flatMap((row) => { const last = readVersions(row as Row).at(-1); return last ? [{ id: row.id as string, subject: last.subject }] : []; });
}

/** Drafts Daylark saved in the last two weeks that are addressed to this person. */
export async function recentDraftsTo(userId: string, address: string): Promise<ExistingDraft[]> {
  requireEnabled();
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data, error } = await table().select("id, gmail_draft_id, gmail_thread_id, versions_ciphertext").eq("user_id", userId).is("discarded_at", null).gte("created_at", since).order("created_at", { ascending: false }).limit(30);
  if (error) throw error;
  const wanted = address.toLowerCase();
  return (data ?? []).flatMap((row) => {
    const last = readVersions(row as Row).at(-1);
    return last && last.to.some((to) => to.toLowerCase() === wanted) ? [{ id: row.id as string, subject: last.subject }] : [];
  }).slice(0, 3);
}
