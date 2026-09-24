import { expect, it } from "vitest";
import { compileEmailSearch } from "./email-search-plan";
import type { EmailRequest } from "./email-request";
const base: EmailRequest = { action: "list", topic: "general", sender: null, days: 30, calendar: null, unread: false, humansOnly: false, exclusion: "" };
it("compiles literal model fields without treating topic words as senders or dates", () => {
 const query = compileEmailSearch({ ...base, searchTerms: ["work order", "Yesterday Company"], excludedTerms: ["promotions"] });
 expect(query).toBe('{"work order" "Yesterday Company"} -"promotions" newer_than:30d');
 expect(query).not.toContain("from:");
});
it("keeps topic and exclusion constraints when widening a window", () => {
 const query = compileEmailSearch({ ...base, sender: "Heritage Park", searchTerms: ["maintenance"], excludedTerms: ["renewal"] }, { ignoreDate: true });
 expect(query).toContain('from:"Heritage Park"');
 expect(query).toContain('{"maintenance"}');
 expect(query).toContain('-"renewal"');
 expect(query).toContain('newer_than:365d');
});
it("escapes query operators supplied inside literal search terms", () => {
 expect(compileEmailSearch({ ...base, searchTerms: ['maintenance" } OR { "anything'] })).not.toContain('} OR {');
});
