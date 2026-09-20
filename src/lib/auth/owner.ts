import { createAdminClient } from "@/lib/supabase/admin";

/** The signed-in person's own name and address, used to sign a draft and to keep them out of "who is it for" matches. Never blocks an answer. */
export async function ownerIdentity(userId: string): Promise<{ name: string | null; email: string | null }> {
  try {
    const { data } = await createAdminClient().auth.admin.getUserById(userId);
    const meta = (data.user?.user_metadata ?? {}) as { full_name?: unknown; name?: unknown };
    const name = [meta.full_name, meta.name].find((value): value is string => typeof value === "string" && value.trim().length > 0);
    return { name: name?.trim().slice(0, 80) ?? null, email: data.user?.email?.toLowerCase() ?? null };
  } catch {
    return { name: null, email: null };
  }
}
