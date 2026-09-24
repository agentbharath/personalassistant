import { createAdminClient } from "@/lib/supabase/admin";
import { decryptText } from "@/lib/security/encryption";
import type { DraftVersion } from "@/lib/drafts/service";

const escape = (text: string) => text.replace(/([\\`*_{}\[\]()#+.!|>~-])/g, "\\$1");

/** Read Daylark's own records across conversations; never infer history from Gmail's other drafts. */
export async function answerDraftHistory(userId: string) {
  const rows: string[] = [];
  let unavailable = 0;
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await createAdminClient().from("email_drafts")
      .select("id,versions_ciphertext,discarded_at,created_at")
      .eq("user_id", userId).order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 99);
    if (error) throw error;
    for (const row of data ?? []) {
      if (!row.versions_ciphertext) { unavailable++; continue; }
      try {
        const versions = JSON.parse(decryptText(row.versions_ciphertext)) as DraftVersion[];
        const latest = versions.at(-1);
        if (!latest || !Array.isArray(latest.to)) { unavailable++; continue; }
        rows.push(`- **${escape(latest.subject || "(No subject)")}** — to ${latest.to.map(escape).join(", ") || "recipient not recorded"}${row.created_at ? ` · ${String(row.created_at).slice(0, 10)}` : ""}${row.discarded_at ? " · discarded" : ""}`);
      } catch { unavailable++; }
    }
    if ((data?.length ?? 0) < 100) break;
  }
  if (!rows.length && !unavailable) return "I haven’t saved any email drafts for you yet. Draft previews that weren’t confirmed aren’t included.";
  return `### Drafts Daylark saved\n\n${rows.join("\n")}${unavailable ? `\n\n${unavailable} earlier draft record${unavailable === 1 ? " has" : "s have"} no readable details remaining (for example, after deletion).` : ""}\n\nThis is Daylark’s saved-draft history across your conversations. It doesn’t verify whether you later sent or deleted a draft in Gmail. [Open Gmail drafts](https://mail.google.com/mail/u/0/#drafts).`;
}
