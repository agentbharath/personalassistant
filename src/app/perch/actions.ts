"use server";

import { revalidatePath } from "next/cache";
import { REPLY_KINDS, type ReplyKind } from "@/lib/agents/reply-needed";
import { dismissThread, savePerchPrefs } from "@/lib/replies/dismissals";
import { createClient } from "@/lib/supabase/server";

async function currentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string") throw new Error("AUTHENTICATION_REQUIRED");
  return userId;
}

/**
 * Saves the owner's Perch choices. `scope` says which form sent it: the first-visit question (`setup-on`, `setup-off`), the kinds list on the
 * card (`kinds`) or the Settings section (`settings`). Only known kinds are accepted, and none ticked is a valid choice.
 */
export async function savePerchChoices(formData: FormData) {
  const userId = await currentUser();
  const kinds = REPLY_KINDS.filter((kind): kind is ReplyKind => formData.getAll("kind").includes(kind));
  const scope = String(formData.get("scope") ?? "");
  if (scope === "setup-on") await savePerchPrefs(userId, { kinds, remindersEnabled: true });
  else if (scope === "setup-off") await savePerchPrefs(userId, { remindersEnabled: false });
  else if (scope === "kinds") await savePerchPrefs(userId, { kinds });
  else if (scope === "settings") await savePerchPrefs(userId, { kinds, perchEnabled: formData.has("perch"), remindersEnabled: formData.has("reminders") });
  revalidatePath("/perch");
  revalidatePath("/settings");
}

/** Hides one thread from "Waiting on your reply" for good. It never touches the email itself. */
export async function dismissReply(formData: FormData) {
  const userId = await currentUser();
  const threadId = String(formData.get("thread") ?? "");
  if (/^[\w-]{6,64}$/.test(threadId)) await dismissThread(userId, threadId);
  revalidatePath("/perch");
}
