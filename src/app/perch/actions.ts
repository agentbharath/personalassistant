"use server";

import { revalidatePath } from "next/cache";
import { dismissThread } from "@/lib/replies/dismissals";
import { createClient } from "@/lib/supabase/server";

/** Hides one thread from "Waiting on your reply" for good. It never touches the email itself. */
export async function dismissReply(formData: FormData) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string") throw new Error("AUTHENTICATION_REQUIRED");
  const threadId = String(formData.get("thread") ?? "");
  if (/^[\w-]{6,64}$/.test(threadId)) await dismissThread(userId, threadId);
  revalidatePath("/perch");
}
