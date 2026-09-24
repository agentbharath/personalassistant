import { Temporal } from "@js-temporal/polyfill";
import type { EmailRequest } from "./email-request";

const quote = (text: string) => `"${text.replace(/["\\\r\n{}]/g, " ").trim()}"`;
const topicTerms = {
  general: [],
  receipt: ["receipt", "invoice", "order confirmation", "payment", "statement", "bill"],
  recruiter: ["recruiter", "recruiting", "talent acquisition", "hiring", "interview", "opportunity"],
  promotion: ["promotion", "offer", "discount", "coupon", "sale"],
};

/** Compile already-interpreted fields. Never parse a rendered sentence to rediscover intent. */
export function compileEmailSearch(request: EmailRequest, options: { ignoreSender?: boolean; ignoreDate?: boolean; timeZone?: string } = {}) {
  const terms = request.searchTerms?.length ? request.searchTerms : topicTerms[request.topic];
  const parts: string[] = [];
  if (request.sender && !options.ignoreSender) parts.push(`{from:${quote(request.sender)} ${quote(request.sender)}}`);
  if (terms.length) parts.push(`{${terms.map(quote).join(" ")}}`);
  if (request.unread) parts.push("is:unread");
  for (const term of request.excludedTerms ?? []) parts.push(`-${quote(term)}`);
  const timeZone = options.timeZone ?? process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";
  if (!options.ignoreDate && request.calendar) {
    const today = Temporal.Now.zonedDateTimeISO(timeZone).toPlainDate();
    const start = request.calendar === "yesterday" ? today.subtract({ days: 1 }) : request.calendar === "this week" ? today.subtract({ days: today.dayOfWeek - 1 }) : today;
    const end = request.calendar === "yesterday" ? today : today.add({ days: 1 });
    parts.push(`after:${Math.floor(start.toZonedDateTime(timeZone).epochMilliseconds / 1000)} before:${Math.floor(end.toZonedDateTime(timeZone).epochMilliseconds / 1000)}`);
  } else if (!options.ignoreDate && request.days) parts.push(`newer_than:${request.days}d`);
  else if (options.ignoreDate) parts.push("newer_than:365d");
  return parts.join(" ") || "newer_than:30d";
}
