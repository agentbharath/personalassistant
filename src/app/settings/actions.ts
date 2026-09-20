"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteAccount, deleteSpendingData } from "@/lib/account/delete";
import { createClient } from "@/lib/supabase/server";
import { deleteAllLearnings, deleteLearnings, learningKey, listLearnings, saveLearning } from "@/lib/learning/store";

async function currentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string") throw new Error("AUTHENTICATION_REQUIRED");
  return userId;
}

/** Forgets one learned preference. The form sends `kind:key`; it is matched against the user's own list before anything is deleted. */
export async function forgetLearning(formData: FormData) {
  const userId = await currentUser();
  const id = String(formData.get("id") ?? "");
  const match = (await listLearnings(userId)).find((learning) => `${learning.kind}:${learningKey(learning)}` === id);
  if (match) await deleteLearnings(userId, [match]);
  revalidatePath("/settings");
}

export async function forgetEverything() {
  await deleteAllLearnings(await currentUser());
  revalidatePath("/settings");
}

/** Removes expenses, income and bills. Chats and learned preferences stay. */
export async function deleteSpendingRecords() {
  await deleteSpendingData(await currentUser());
  revalidatePath("/settings");
}

/** Deletes the account and all its data, then signs out. The typed confirmation is checked here too, not only in the dialog. */
export async function deleteMyAccount(confirmation: string) {
  if (confirmation.trim().toLowerCase() !== "delete my account") throw new Error("CONFIRMATION_REQUIRED");
  const userId = await currentUser();
  await deleteAccount(userId);
  try { await (await createClient()).auth.signOut(); } catch { /* the account is already gone; the session cookie is cleared below by leaving */ }
  redirect("/login");
}

/** Saves the home location (a city or ZIP). It is stored encrypted like the other learned preferences. */
export async function saveHomeLocation(place: string) {
  const value = place.replace(/\s+/g, " ").trim();
  if (value.length < 2 || value.length > 100) throw new Error("INVALID_LOCATION");
  await saveLearning(await currentUser(), { kind: "home_location", place: value });
  revalidatePath("/settings");
}

export async function clearHomeLocation() {
  await deleteLearnings(await currentUser(), [{ kind: "home_location", place: "" }]);
  revalidatePath("/settings");
}
