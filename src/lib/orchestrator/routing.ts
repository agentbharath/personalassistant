// R20.5: nothing here decides what a user's message means. `isEmailFinanceImport` reads text Daylark itself rendered, and `isPublicSearchQuery`
// only checks the clauses of a plan the model already made (multi-agent.ts). The fixed notice is what is shown when a write is declined.
export function isEmailFinanceImport(input: string) {
  const normalized = input.toLowerCase();
  return /\b(import|record|add|save)\b/.test(normalized) && /\b(receipts?|invoices?|orders?|bills?|statements?|purchases?|spendings?|expenses?|payments?)\b/.test(normalized);
}

export function isPublicSearchQuery(input: string) {
  const normalized = input.toLowerCase();
  return /\b(best|recommend|find|look up|latest|current|near me|nearby)\b/.test(normalized)
    && /\b(restaurant|restaurants|food|place|places|concert|movie|event|hotel|cafe|coffee|shop|store)\b/.test(normalized);
}

export const EMAIL_READ_ONLY_NOTICE = "Daylark’s Gmail access is read-only right now, so I can’t delete, archive, forward, or send email. I can find the message and show you what it says, and you can act on it in Gmail.";
