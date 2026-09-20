import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptText, encryptText } from "@/lib/security/encryption";
import { piiHmac } from "@/lib/security/pii-hmac";
import { calendarEventId, createCalendarEvent, deleteApprovedCalendarEvent, updateCalendarEventAttendees, type CalendarEventCandidate } from "@/lib/tools/calendar/google-calendar";
import { GoogleConnectionRequiredError } from "@/lib/auth/google-credential-broker";
import { GoogleCalendarAccessError } from "@/lib/tools/calendar/google-calendar";

export async function createCalendarApproval(userId: string, conversationId: string, candidate: CalendarEventCandidate) {
  const admin = createAdminClient();
  const payloadCiphertext = encryptText(JSON.stringify(candidate));
  const { data: checkpoint, error } = await admin.from("workflow_checkpoints").insert({ user_id: userId, conversation_id: conversationId, request_id: randomUUID(), workflow_type: "calendar_create", state: "pending_approval", checkpoint: { payloadCiphertext, validationVersion: 1 } }).select("id").single();
  if (error) throw error;
  const { error: approvalError } = await admin.from("approvals").insert({ user_id: userId, workflow_checkpoint_id: checkpoint.id, preview_hash: piiHmac(payloadCiphertext), status: "pending", expires_at: new Date(Date.now() + 30 * 60_000).toISOString() });
  if (approvalError) throw approvalError;
}

export async function resolvePendingCalendarCreate(userId: string, conversationId: string, input: string) {
  const decision = /^(confirm|approve|yes|create it|add it|go ahead)[.!]?$/i.test(input.trim()) ? "approve" : /^(cancel|deny|no|stop)[.!]?$/i.test(input.trim()) ? "deny" : null;
  if (!decision) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("workflow_checkpoints").select("id,checkpoint").eq("user_id", userId).eq("conversation_id", conversationId).eq("workflow_type", "calendar_create").eq("state", "pending_approval").order("created_at", { ascending: false }).limit(1);
  const checkpoint = data?.[0];
  if (!checkpoint) return null;
  const { data: approval } = await admin.from("approvals").select("id,expires_at,status").eq("workflow_checkpoint_id", checkpoint.id).in("status", ["pending", "approved"]).maybeSingle();
  if (!approval) return null;
  if (decision === "deny" || new Date(approval.expires_at as string).getTime() <= Date.now()) {
    const expired = decision !== "deny";
    await Promise.all([admin.from("approvals").update({ status: expired ? "expired" : "denied" }).eq("id", approval.id), admin.from("workflow_checkpoints").update({ state: expired ? "expired" : "cancelled" }).eq("id", checkpoint.id)]);
    return { answer: expired ? "That calendar preview expired. Ask me to prepare it again." : "Calendar creation cancelled. Nothing was added or sent.", status: expired ? "waiting_for_user" as const : "completed" as const };
  }
  const payload = (checkpoint.checkpoint as { payloadCiphertext?: string }).payloadCiphertext;
  if (!payload) throw new Error("CALENDAR_CHECKPOINT_INVALID");
  if (approval.status === "pending") {
    const { data: claimed } = await admin.from("approvals").update({ status: "approved" }).eq("id", approval.id).eq("status", "pending").select("id").maybeSingle();
    if (!claimed) return { answer: "That calendar action is already being processed. Please wait a moment.", status: "waiting_for_user" as const };
  }
  const candidate = JSON.parse(decryptText(payload)) as CalendarEventCandidate;
  try {
    const result = await createCalendarEvent(userId, candidate);
    await Promise.all([admin.from("approvals").update({ status: "consumed", consumed_at: new Date().toISOString() }).eq("id", approval.id), admin.from("workflow_checkpoints").update({ state: "completed" }).eq("id", checkpoint.id)]);
    return { answer: result.duplicate ? "That event was already on your calendar; I did not create another copy." : `Created **${candidate.summary}** on your calendar${candidate.attendees.length ? " and sent the invitation" : ""}.`, status: "completed" as const };
  } catch (creationError) {
    await admin.from("approvals").update({ status: "pending" }).eq("id", approval.id).eq("status", "approved");
    if (creationError instanceof GoogleConnectionRequiredError || (creationError instanceof GoogleCalendarAccessError && creationError.reason === "insufficient_scope")) {
      return { answer: "Calendar write access has not been granted yet. Sign out, reconnect Google, approve Calendar access, then return here and select **Confirm** again. Nothing was created or sent.", status: "waiting_for_user" as const };
    }
    if (creationError instanceof GoogleCalendarAccessError) {
      return { answer: "Google Calendar could not confirm the event creation. Nothing will be duplicated; use **Confirm** to retry safely or **Cancel**. If this continues, reconnect Google Calendar.", status: "waiting_for_user" as const };
    }
    throw creationError;
  }
}

type CalendarAttendeeUpdate = { eventId: string; summary: string; attendees: string[]; removed: string[]; added: string[] };

export async function prepareCalendarAttendeeUpdate(userId: string, conversationId: string, input: string) {
  const removed = matchEmailsAfter(input, "remove");
  const added = matchEmailsAfter(input, "add");
  if (!removed.length && !added.length) return "Tell me which guest to remove or add. Nothing was changed.";

  const admin = createAdminClient();
  const [{ data }, { data: priorUpdates }] = await Promise.all([
    admin.from("workflow_checkpoints").select("checkpoint,created_at").eq("user_id", userId).eq("conversation_id", conversationId).eq("workflow_type", "calendar_create").eq("state", "completed").order("created_at", { ascending: false }).limit(1),
    admin.from("workflow_checkpoints").select("checkpoint,created_at").eq("user_id", userId).eq("conversation_id", conversationId).eq("workflow_type", "calendar_attendee_update").eq("state", "completed").order("created_at", { ascending: false }).limit(1),
  ]);
  const encrypted = (data?.[0]?.checkpoint as { payloadCiphertext?: string } | undefined)?.payloadCiphertext;
  if (!encrypted) return "I couldn’t identify a calendar event created in this conversation. Nothing was changed.";
  const candidate = JSON.parse(decryptText(encrypted)) as CalendarEventCandidate;
  const priorEncrypted = (priorUpdates?.[0]?.checkpoint as { payloadCiphertext?: string } | undefined)?.payloadCiphertext;
  const priorUpdate = priorEncrypted && new Date(priorUpdates![0].created_at as string) > new Date(data![0].created_at as string)
    ? JSON.parse(decryptText(priorEncrypted)) as CalendarAttendeeUpdate
    : null;
  const attendeeSet = new Set((priorUpdate?.attendees ?? candidate.attendees).map((email) => email.toLowerCase()));
  removed.forEach((email) => attendeeSet.delete(email));
  added.forEach((email) => attendeeSet.add(email));
  const update: CalendarAttendeeUpdate = { eventId: calendarEventId(userId, candidate), summary: candidate.summary, attendees: [...attendeeSet], removed, added };
  const payloadCiphertext = encryptText(JSON.stringify(update));
  const { data: checkpoint, error } = await admin.from("workflow_checkpoints").insert({ user_id: userId, conversation_id: conversationId, request_id: randomUUID(), workflow_type: "calendar_attendee_update", state: "pending_approval", checkpoint: { payloadCiphertext, validationVersion: 1 } }).select("id").single();
  if (error) throw error;
  const { error: approvalError } = await admin.from("approvals").insert({ user_id: userId, workflow_checkpoint_id: checkpoint.id, preview_hash: piiHmac(payloadCiphertext), status: "pending", expires_at: new Date(Date.now() + 30 * 60_000).toISOString() });
  if (approvalError) throw approvalError;
  return `### Review guest changes\n\n- **Event:** ${candidate.summary}${removed.length ? `\n- **Remove:** ${removed.join(", ")}` : ""}${added.length ? `\n- **Add:** ${added.join(", ")}` : ""}\n- **Guests after update:** ${update.attendees.length ? update.attendees.join(", ") : "None"}\n\nChoose **Confirm** to update the event and notify affected guests, or **Cancel**. This preview expires in 30 minutes.`;
}

export async function resolvePendingCalendarAttendeeUpdate(userId: string, conversationId: string, input: string) {
  const decision = /^(confirm|approve|yes|update it|go ahead)[.!]?$/i.test(input.trim()) ? "approve" : /^(cancel|deny|no|stop)[.!]?$/i.test(input.trim()) ? "deny" : null;
  if (!decision) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("workflow_checkpoints").select("id,checkpoint").eq("user_id", userId).eq("conversation_id", conversationId).eq("workflow_type", "calendar_attendee_update").eq("state", "pending_approval").order("created_at", { ascending: false }).limit(1);
  const checkpoint = data?.[0];
  if (!checkpoint) return null;
  const { data: approval } = await admin.from("approvals").select("id,expires_at,status").eq("workflow_checkpoint_id", checkpoint.id).in("status", ["pending", "approved"]).maybeSingle();
  if (!approval) return null;
  if (decision === "deny" || new Date(approval.expires_at as string).getTime() <= Date.now()) {
    const expired = decision !== "deny";
    await Promise.all([admin.from("approvals").update({ status: expired ? "expired" : "denied" }).eq("id", approval.id), admin.from("workflow_checkpoints").update({ state: expired ? "expired" : "cancelled" }).eq("id", checkpoint.id)]);
    return { answer: expired ? "That guest-update preview expired. Ask me to prepare it again." : "Calendar update cancelled. Nothing was changed or sent.", status: "waiting_for_user" as const };
  }
  const payload = (checkpoint.checkpoint as { payloadCiphertext?: string }).payloadCiphertext;
  if (!payload) throw new Error("CALENDAR_UPDATE_CHECKPOINT_INVALID");
  if (approval.status === "pending") {
    const { data: claimed } = await admin.from("approvals").update({ status: "approved" }).eq("id", approval.id).eq("status", "pending").select("id").maybeSingle();
    if (!claimed) return { answer: "That calendar update is already being processed.", status: "waiting_for_user" as const };
  }
  const update = JSON.parse(decryptText(payload)) as CalendarAttendeeUpdate;
  try {
    await updateCalendarEventAttendees(userId, update.eventId, update.attendees);
    await Promise.all([admin.from("approvals").update({ status: "consumed", consumed_at: new Date().toISOString() }).eq("id", approval.id), admin.from("workflow_checkpoints").update({ state: "completed" }).eq("id", checkpoint.id)]);
    return { answer: `Updated the guests for **${update.summary}** and sent Google Calendar notifications.`, status: "completed" as const };
  } catch (updateError) {
    await admin.from("approvals").update({ status: "pending" }).eq("id", approval.id).eq("status", "approved");
    if (updateError instanceof GoogleConnectionRequiredError || updateError instanceof GoogleCalendarAccessError) return { answer: "Google Calendar could not confirm the guest update. Nothing was changed. Reconnect Google Calendar if needed, then choose **Confirm** to retry safely or **Cancel**.", status: "waiting_for_user" as const };
    throw updateError;
  }
}

function matchEmailsAfter(input: string, verb: "remove" | "add") {
  const match = input.match(new RegExp(`\\b${verb}\\s+([\\w.+-]+@[\\w.-]+\\.[a-z]{2,})`, "ig")) ?? [];
  return [...new Set(match.map((value) => value.replace(new RegExp(`^${verb}\\s+`, "i"), "").toLowerCase()))];
}

type CalendarDeleteCandidate = { eventId: string; summary: string; start: string; timeZone?: string | null; attendees: string[] };

export async function prepareCalendarDelete(userId: string, conversationId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("workflow_checkpoints").select("checkpoint").eq("user_id", userId).eq("conversation_id", conversationId).eq("workflow_type", "calendar_create").eq("state", "completed").order("created_at", { ascending: false }).limit(1);
  const encrypted = (data?.[0]?.checkpoint as { payloadCiphertext?: string } | undefined)?.payloadCiphertext;
  if (!encrypted) return "I couldn’t identify an event created in this conversation. Tell me the exact event title and date; nothing was removed.";
  const candidate = JSON.parse(decryptText(encrypted)) as CalendarEventCandidate;
  const deletion: CalendarDeleteCandidate = { eventId: calendarEventId(userId, candidate), summary: candidate.summary, start: candidate.start, timeZone: candidate.timeZone, attendees: candidate.attendees };
  const payloadCiphertext = encryptText(JSON.stringify(deletion));
  const { data: checkpoint, error } = await admin.from("workflow_checkpoints").insert({ user_id: userId, conversation_id: conversationId, request_id: randomUUID(), workflow_type: "calendar_delete", state: "pending_approval", checkpoint: { payloadCiphertext, validationVersion: 1 } }).select("id").single();
  if (error) throw error;
  const { error: approvalError } = await admin.from("approvals").insert({ user_id: userId, workflow_checkpoint_id: checkpoint.id, preview_hash: piiHmac(payloadCiphertext), status: "pending", expires_at: new Date(Date.now() + 30 * 60_000).toISOString() });
  if (approvalError) throw approvalError;
  const zone = candidate.timeZone ?? process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";
  const when = new Intl.DateTimeFormat("en-US", { timeZone: zone, dateStyle: "medium", timeStyle: "short" }).format(new Date(candidate.start));
  return `### Review calendar deletion\n\n- **Event:** ${candidate.summary}\n- **Starts:** ${when}\n- **Time zone:** ${zone}${candidate.attendees.length ? `\n- **Guests notified:** ${candidate.attendees.join(", ")}` : ""}\n\nThis will permanently remove the event from your calendar and notify its guests. Choose **Confirm** to delete it, or **Cancel** to keep it. This preview expires in 30 minutes.`;
}

export async function resolvePendingCalendarDelete(userId: string, conversationId: string, input: string) {
  const decision = /^(confirm|approve|yes|delete it|remove it|go ahead)[.!]?$/i.test(input.trim()) ? "approve" : /^(cancel|deny|no|stop|keep it)[.!]?$/i.test(input.trim()) ? "deny" : null;
  if (!decision) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("workflow_checkpoints").select("id,checkpoint").eq("user_id", userId).eq("conversation_id", conversationId).eq("workflow_type", "calendar_delete").eq("state", "pending_approval").order("created_at", { ascending: false }).limit(1);
  const checkpoint = data?.[0];
  if (!checkpoint) return null;
  const { data: approval } = await admin.from("approvals").select("id,expires_at,status").eq("workflow_checkpoint_id", checkpoint.id).in("status", ["pending", "approved"]).maybeSingle();
  if (!approval) return null;
  if (decision === "deny" || new Date(approval.expires_at as string).getTime() <= Date.now()) {
    const expired = decision !== "deny";
    await Promise.all([admin.from("approvals").update({ status: expired ? "expired" : "denied" }).eq("id", approval.id), admin.from("workflow_checkpoints").update({ state: expired ? "expired" : "cancelled" }).eq("id", checkpoint.id)]);
    return { answer: expired ? "That deletion preview expired. Ask me to prepare it again." : "Calendar deletion cancelled. The event was kept.", status: "waiting_for_user" as const };
  }
  const payload = (checkpoint.checkpoint as { payloadCiphertext?: string }).payloadCiphertext;
  if (!payload) throw new Error("CALENDAR_DELETE_CHECKPOINT_INVALID");
  if (approval.status === "pending") {
    const { data: claimed } = await admin.from("approvals").update({ status: "approved" }).eq("id", approval.id).eq("status", "pending").select("id").maybeSingle();
    if (!claimed) return { answer: "That calendar deletion is already being processed.", status: "waiting_for_user" as const };
  }
  const deletion = JSON.parse(decryptText(payload)) as CalendarDeleteCandidate;
  try {
    const result = await deleteApprovedCalendarEvent(userId, deletion.eventId);
    await Promise.all([admin.from("approvals").update({ status: "consumed", consumed_at: new Date().toISOString() }).eq("id", approval.id), admin.from("workflow_checkpoints").update({ state: "completed" }).eq("id", checkpoint.id)]);
    return { answer: result.alreadyDeleted ? `**${deletion.summary}** was already absent from your calendar.` : `Deleted **${deletion.summary}** from your calendar${deletion.attendees.length ? " and notified its guests" : ""}.`, status: "completed" as const };
  } catch (deleteError) {
    await admin.from("approvals").update({ status: "pending" }).eq("id", approval.id).eq("status", "approved");
    if (deleteError instanceof GoogleConnectionRequiredError || deleteError instanceof GoogleCalendarAccessError) return { answer: "Google Calendar could not confirm the deletion. Nothing was removed. Reconnect Google Calendar if needed, then choose **Confirm** to retry safely or **Cancel**.", status: "waiting_for_user" as const };
    throw deleteError;
  }
}
