import { createAdminClient } from "@/lib/supabase/admin";
import { buildDaySummary } from "@/lib/today/summary";
import { isPerchEnabled } from "@/lib/replies/dismissals";
import { digestDate, digestParameters, DigestRejected, sendDigest, whatsappConfig } from "./whatsapp";
export async function runMorningDigest(now = new Date()) {
 const config = whatsappConfig();
 const date = digestDate(now);
 if (!config || !date || !(await isPerchEnabled(config.userId))) return {status: "skipped"};
 const admin = createAdminClient();
 // Unique user/date claim prevents both DST cron slots and concurrent invocations from sending twice.
 const {error} = await admin.from("digest_log").insert({user_id: config.userId, local_date: date, status: "claimed"});
 if (error?.code === "23505") return {status: "already_claimed"};
 if (error) throw error;
 let attempted = false;
 try {
   const summary = await buildDaySummary(config.userId);
   const parameters = digestParameters(summary, config.origin);
   attempted = true;
   const id = await sendDigest(config, parameters);
   const {error: saved} = await admin.from("digest_log").update({status: "sent", provider_message_id: id}).eq("user_id", config.userId).eq("local_date", date);
   if (saved) throw saved;
   return {status: "sent"};
 } catch (error) {
   const status = !attempted || error instanceof DigestRejected ? "failed" : "unknown";
   const {error: saved} = await admin.from("digest_log").update({status}).eq("user_id", config.userId).eq("local_date", date);
   if (saved) throw saved;
   // Unknown delivery is never automatically retried; that could duplicate a real send.
   return {status};
 }
}
