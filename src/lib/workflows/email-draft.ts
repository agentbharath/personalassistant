import { randomUUID } from "node:crypto";
import { GoogleConnectionRequiredError } from "@/lib/auth/google-credential-broker";
import { DraftNotFoundError, DraftsDisabledError, createDraft, discardDraft, editDraft, revertDraft } from "@/lib/drafts/service";
import type { DraftPayload } from "@/lib/drafts/payload";
import { decryptText, encryptText } from "@/lib/security/encryption";
import { piiHmac } from "@/lib/security/pii-hmac";
import { GoogleGmailAccessError } from "@/lib/tools/email/google-gmail";
import { createAdminClient } from "@/lib/supabase/admin";

const WORKFLOW = "email_draft";
const DRAFTS_URL = "https://mail.google.com/mail/u/0/#drafts";
const RECONNECT = "To save drafts I need permission to write drafts to your Gmail. Open Settings, then Connections, choose Reconnect Google and approve drafts, then choose **Confirm** again. I can never send email, with or without that permission. Nothing was saved.";

/** R25: a draft action waits for Confirm. A newer preview replaces an older one, so Confirm always does what the latest preview showed. */
export async function createDraftApproval(userId: string, conversationId: string, payload: DraftPayload) {
  const admin = createAdminClient();
  await admin.from("workflow_checkpoints").update({ state: "cancelled" }).eq("user_id", userId).eq("conversation_id", conversationId).eq("workflow_type", WORKFLOW).eq("state", "pending_approval");
  const payloadCiphertext = encryptText(JSON.stringify(payload));
  const { data: checkpoint, error } = await admin.from("workflow_checkpoints").insert({ user_id: userId, conversation_id: conversationId, request_id: randomUUID(), workflow_type: WORKFLOW, state: "pending_approval", checkpoint: { payloadCiphertext, validationVersion: 1 } }).select("id").single();
  if (error) throw error;
  const { error: approvalError } = await admin.from("approvals").insert({ user_id: userId, workflow_checkpoint_id: checkpoint.id, preview_hash: piiHmac(payloadCiphertext), status: "pending", expires_at: new Date(Date.now() + 30 * 60_000).toISOString() });
  if (approvalError) throw approvalError;
}

export type DraftPreviewState = "pending" | "cancelled" | "expired" | "completed";

/**
 * The newest draft preview in this conversation, in whatever state it ended up: still waiting, cancelled, expired or saved. "Make it shorter" or
 * "make it professional" refers to the last draft that was shown, so it must not depend on whether the person confirmed it.
 */
export async function lastDraftPreview(userId: string, conversationId: string): Promise<{ state: DraftPreviewState; payload: DraftPayload } | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("workflow_checkpoints").select("id,state,checkpoint").eq("user_id", userId).eq("conversation_id", conversationId).eq("workflow_type", WORKFLOW).order("created_at", { ascending: false }).limit(1);
  const checkpoint = data?.[0];
  if (!checkpoint) return null;
  const ciphertext = (checkpoint.checkpoint as { payloadCiphertext?: string }).payloadCiphertext;
  if (!ciphertext) return null;
  let payload: DraftPayload;
  try { payload = JSON.parse(decryptText(ciphertext)) as DraftPayload; } catch { return null; }
  if (checkpoint.state === "pending_approval") {
    const { data: approval } = await admin.from("approvals").select("expires_at").eq("workflow_checkpoint_id", checkpoint.id).eq("status", "pending").maybeSingle();
    const live = approval && new Date(approval.expires_at as string).getTime() > Date.now();
    return { state: live ? "pending" : "expired", payload };
  }
  return { state: checkpoint.state === "completed" ? "completed" : checkpoint.state === "expired" ? "expired" : "cancelled", payload };
}

type Outcome = { answer: string; status: "completed" | "waiting_for_user" };

/** Runs an approved draft action. Exported for tests; `resolvePendingEmailDraft` is the entry point. */
export async function runDraftPayload(userId: string, conversationId: string, payload: DraftPayload): Promise<Outcome> {
  if (payload.action === "create") {
    await createDraft(userId, conversationId, payload.spec);
    return { answer: `Saved to your Gmail Drafts as “${payload.spec.subject}”. It has **not** been sent, and I never send email: you read it and send it yourself. [Open your drafts](${DRAFTS_URL}).\n\nWant changes? Say “make it shorter” or “add that I'm free after 3”. To undo a change, say “go back to the previous version”.`, status: "completed" };
  }
  if (payload.action === "edit") {
    // If the person edited the draft in Gmail since Daylark wrote it, their edit is kept as a version first, so nothing is lost.
    const result = await editDraft(userId, payload.draftId, { body: payload.body, subject: payload.subject }, { keepLive: true });
    if (result.status === "gone") return { answer: "That draft is no longer in your Gmail Drafts (it may have been sent or deleted), so I left it alone.", status: "completed" };
    return { answer: "Updated the draft in your Gmail Drafts. Still not sent. To undo, say “go back to the previous version”.", status: "completed" };
  }
  if (payload.action === "revert") {
    const result = await revertDraft(userId, payload.draftId, payload.versionIndex, { keepLive: true });
    if (result.status === "gone") return { answer: "That draft is no longer in your Gmail Drafts, so I left it alone.", status: "completed" };
    return { answer: `Put version ${payload.versionIndex + 1} back into the draft. To go forward again, say “go back to the latest version”.`, status: "completed" };
  }
  const result = await discardDraft(userId, payload.draftId, { force: true });
  return { answer: result.status === "gone" ? "That draft was already gone from your Gmail Drafts." : "Deleted the draft from your Gmail Drafts. Nothing was sent.", status: "completed" };
}

/** Confirm or Cancel on a pending draft action. Null when none is waiting. */
export async function resolvePendingEmailDraft(userId: string, conversationId: string, word: "confirm" | "cancel"): Promise<Outcome | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("workflow_checkpoints").select("id,checkpoint").eq("user_id", userId).eq("conversation_id", conversationId).eq("workflow_type", WORKFLOW).eq("state", "pending_approval").order("created_at", { ascending: false }).limit(1);
  const checkpoint = data?.[0];
  if (!checkpoint) return null;
  const { data: approval } = await admin.from("approvals").select("id,expires_at,status").eq("workflow_checkpoint_id", checkpoint.id).in("status", ["pending", "approved"]).maybeSingle();
  if (!approval) return null;

  if (word === "cancel" || new Date(approval.expires_at as string).getTime() <= Date.now()) {
    const expired = word !== "cancel";
    await Promise.all([admin.from("approvals").update({ status: expired ? "expired" : "denied" }).eq("id", approval.id), admin.from("workflow_checkpoints").update({ state: expired ? "expired" : "cancelled" }).eq("id", checkpoint.id)]);
    return { answer: expired ? "That draft preview expired. Ask me to write it again." : "Cancelled. Nothing was saved or sent.", status: expired ? "waiting_for_user" : "completed" };
  }

  const ciphertext = (checkpoint.checkpoint as { payloadCiphertext?: string }).payloadCiphertext;
  if (!ciphertext) throw new Error("DRAFT_CHECKPOINT_INVALID");
  if (approval.status === "pending") {
    const { data: claimed } = await admin.from("approvals").update({ status: "approved" }).eq("id", approval.id).eq("status", "pending").select("id").maybeSingle();
    if (!claimed) return { answer: "That draft is already being saved. Please wait a moment.", status: "waiting_for_user" };
  }
  try {
    const outcome = await runDraftPayload(userId, conversationId, JSON.parse(decryptText(ciphertext)) as DraftPayload);
    await Promise.all([admin.from("approvals").update({ status: "consumed", consumed_at: new Date().toISOString() }).eq("id", approval.id), admin.from("workflow_checkpoints").update({ state: "completed" }).eq("id", checkpoint.id)]);
    return outcome;
  } catch (error) {
    await admin.from("approvals").update({ status: "pending" }).eq("id", approval.id).eq("status", "approved");
    if (error instanceof GoogleConnectionRequiredError || (error instanceof GoogleGmailAccessError && error.reason === "insufficient_scope")) return { answer: RECONNECT, status: "waiting_for_user" };
    if (error instanceof DraftsDisabledError) return { answer: "Drafting is switched off right now, so nothing was saved.", status: "completed" };
    if (error instanceof DraftNotFoundError) return { answer: "I can't find that draft any more, so I left it alone.", status: "completed" };
    throw error;
  }
}
