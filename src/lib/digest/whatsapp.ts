import { Temporal } from "@js-temporal/polyfill";
import type { DaySummary } from "@/lib/today/summary";
import { displayName } from "@/lib/replies/waiting";
export const DIGEST_TIME_ZONE = "America/Los_Angeles";
export function digestDate(now: Date) {
 const local = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(DIGEST_TIME_ZONE);
 return local.hour === 7 ? local.toPlainDate().toString() : null;
}
export const singleLine = (text: string, max = 350) => text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
export function digestParameters(summary: DaySummary, origin: string) {
 const meetings = summary.view.meetingsToday;
 let agenda = "a calendar update waiting in Perch (calendar unavailable)";
 if (meetings.state === "ok") {
   const sorted = [...meetings.value].sort((a, b) => a.start.localeCompare(b.start));
   const first = sorted.find(m => !m.allDay);
   agenda = `${sorted.length} calendar event${sorted.length === 1 ? "" : "s"}`;
   if (first) agenda += `, first timed event at ${new Intl.DateTimeFormat("en-US", {hour: "numeric", minute: "2-digit", timeZone: DIGEST_TIME_ZONE}).format(new Date(first.start))}`;
 }
 const replies = summary.replies;
 let count = replies.state === "off" ? "Reply reminders are turned off." : replies.state === "setup" ? "Choose your reply reminders in Perch." : "Reply reminders could not be checked.";
 let names = "Open Perch for details.";
 if (replies.state === "ok") {
   const visible = replies.items.filter(item => replies.prefs.kinds.includes(item.kind));
   count = `${replies.checked < replies.total ? "So far, " : ""}${visible.length} email${visible.length === 1 ? " may" : "s may"} need your reply.`;
   names = visible.length ? `Including ${visible.slice(0, 2).map(item => displayName(item.from)).join(" and ")}.` : replies.checked < replies.total ? "Some messages still need checking." : "None found in your selected reminder categories.";
 }
 const url = new URL("/perch", origin);
 if (url.protocol !== "https:") throw new Error("DIGEST_REQUIRES_HTTPS_ORIGIN");
 return [agenda, count, names, url.toString()].map(text => singleLine(text));
}
export type WhatsAppConfig = {userId: string; token: string; phoneId: string; recipient: string; version: string; origin: string; template: string};
export function whatsappConfig(): WhatsAppConfig | null {
 if (process.env.WHATSAPP_DIGEST_ENABLED !== "true") return null;
 const {WHATSAPP_DIGEST_USER_ID: userId, WHATSAPP_ACCESS_TOKEN: token, WHATSAPP_PHONE_NUMBER_ID: phoneId, WHATSAPP_RECIPIENT: recipient, WHATSAPP_GRAPH_VERSION: version, APP_ORIGIN: origin} = process.env;
 if (!userId || !token || !phoneId || !recipient || !version || !origin) throw new Error("WHATSAPP_CONFIGURATION_INCOMPLETE");
 if (!/^\d+$/.test(phoneId) || !/^\d{8,15}$/.test(recipient) || !/^v\d+\.\d+$/.test(version)) throw new Error("WHATSAPP_CONFIGURATION_INVALID");
 return {userId, token, phoneId, recipient, version, origin, template: process.env.WHATSAPP_DIGEST_TEMPLATE ?? "daily_digest"};
}
export class DigestRejected extends Error {}
export async function sendDigest(config: WhatsAppConfig, parameters: string[], send = fetch) {
 // No automatic retry: a timeout can happen after Meta accepted the message.
 const response = await send(`https://graph.facebook.com/${config.version}/${config.phoneId}/messages`, {
   method: "POST", headers: {authorization: `Bearer ${config.token}`, "content-type": "application/json"}, signal: AbortSignal.timeout(15_000),
   body: JSON.stringify({messaging_product: "whatsapp", to: config.recipient, type: "template", template: {name: config.template, language: {code: "en_US"}, components: [{type: "body", parameters: parameters.map(text => ({type: "text", text: singleLine(text)}))}]}}),
 });
 if (!response.ok) {
   if (response.status >= 400 && response.status < 500) throw new DigestRejected("WHATSAPP_REJECTED");
   throw new Error("WHATSAPP_DELIVERY_UNKNOWN");
 }
 const body = await response.json() as {messages?: {id: string}[]};
 if (!body.messages?.[0]?.id) throw new Error("WHATSAPP_DELIVERY_UNKNOWN");
 return body.messages[0].id;
}
