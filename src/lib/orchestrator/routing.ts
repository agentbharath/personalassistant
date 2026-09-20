export function isEmailFinanceImport(input: string) {
  const normalized = input.toLowerCase();
  return /\b(import|record|add|save)\b/.test(normalized) && /\b(receipts?|invoices?|orders?|bills?|statements?|purchases?)\b/.test(normalized);
}

export function isCalendarCreate(input: string) {
  return /\b(add|create|schedule|put|make)\b/i.test(input) && /\b(calendar|event|invite|meeting|appointment)\b/i.test(input);
}

export function isCalendarAttendeeUpdate(input: string) {
  return /\b(?:remove|add)\s+[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(input)
    && (/\b(?:remove|add).+\b(?:and|then)\s+(?:remove|add)\b/i.test(input) || /\b(?:actually|instead|guest|attendee|invitee|invitation|event|list)\b/i.test(input));
}

export function isCalendarDelete(input: string) {
  return /\b(?:delete|remove|cancel)\b/i.test(input)
    && /\b(?:calendar|event|meeting|appointment|concert|invite|invitation)\b/i.test(input)
    && !/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(input);
}

export function isScheduleFeasibility(input: string) {
  const normalized = input.toLowerCase();
  return /\b(movie|concert|show|event|game|appointment|dinner|lunch)\b/.test(normalized)
    && /\b(before|after|meeting|calendar|make it|enough time|come back|return|fit)\b/.test(normalized);
}

export function isPublicSearchQuery(input: string) {
  const normalized = input.toLowerCase();
  return /\b(best|recommend|find|look up|latest|current|near me|nearby)\b/.test(normalized)
    && /\b(restaurant|restaurants|food|place|places|concert|movie|event|hotel|cafe|coffee|shop|store)\b/.test(normalized);
}

export function isEmailSearch(input: string) {
  const normalized = input.toLowerCase().replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, " ");
  return /\b(email|emails|mail|inbox|gmail)\b/.test(normalized) && !/\b(import|record|add|save)\b/.test(normalized);
}

export function deterministicReadOnlyAgents(input: string) {
  if (/\b(import|record|add|save|create|schedule|delete|remove|cancel|send|reply)\b/i.test(input)) return [];
  const normalized = input.toLowerCase();
  const agents = [
    /\b(calendar|meeting|meetings|schedule|free|available|availability)\b/.test(normalized) && "calendar",
    /\b(email|emails|mail|mails|inbox|gmail|recruiter|recruiters|receipts?|invoices?|tickets?)\b/.test(normalized) && "email",
    new RegExp(String.raw`\b(spend|spent|spending|transactions?|expense|expenses|${isPublicSearchQuery(normalized) ? "" : "restaurants?|"}finance|finances)\b`).test(normalized) && "finance",
    isPublicSearchQuery(normalized) && "general",
  ].filter(Boolean) as Array<"calendar" | "email" | "finance" | "general">;
  return agents.length >= 2 ? agents : [];
}

export function classifyDeterministicRouteForEval(input: string) {
  if (isCalendarAttendeeUpdate(input)) return "calendar_attendee_update";
  if (isCalendarDelete(input)) return "calendar_delete";
  if (isCalendarCreate(input)) return "calendar_create";
  if (isEmailFinanceImport(input)) return "email_finance_import";
  if (deterministicReadOnlyAgents(input).length > 1) return "multi_agent_parallel";
  if (isScheduleFeasibility(input)) return "schedule_feasibility";
  if (isEmailSearch(input)) return "email_search";
  if (isPublicSearchQuery(input)) return "public_search";
  return "model_classification";
}

/** Gmail access is read-only, so email writes are declined up front instead of being treated as searches. */
export function isEmailMutation(input: string) {
  if (/\b(?:calendar|event|meeting|appointment|invite|invitation)\b/i.test(input)) return false;
  return /\b(?:delete|trash|archive|forward|unsubscribe(?: from)?|mark|label|move)\b[^.?!]*\b(?:emails?|mails?|messages?|inbox|thread)\b/i.test(input)
    || /\b(?:forward|send)\b[^.?!]*[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(input)
    || /\b(?:send|write|draft|reply(?: to)?)\b[^.?!]*\b(?:an?\s+)?(?:emails?|mails?|message)\b/i.test(input);
}

export const EMAIL_READ_ONLY_NOTICE = "Daylark’s Gmail access is read-only right now, so I can’t delete, archive, forward, or send email. I can find the message and show you what it says, and you can act on it in Gmail.";
