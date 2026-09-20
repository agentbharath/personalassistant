import type { Learning } from "./learnings";

export type LearningsCommand = { type: "show" } | { type: "forget"; term: string } | { type: "forget_all" } | { type: "confirm_forget_all" };

const SHOW = /^(?:what (?:have|did) you (?:learned?|learnt|remember(?:ed)?)(?: about me)?|what do you (?:remember|know) about (?:me|my preferences)|what do you remember|show (?:me )?(?:my )?(?:preferences|settings|corrections|learned (?:things|preferences)|what you(?:'ve| have) learned)|what(?:'s| is) saved|list (?:my )?(?:preferences|corrections|learnings?))[?.! ]*$/i;
const FORGET_ALL = /^(?:forget (?:everything|all(?: of)?(?: it| that| this)?)|reset (?:everything|what you(?:'ve| have) learned|my preferences)|clear (?:everything|all(?: my)? (?:preferences|learnings?)|what you(?:'ve| have) learned))[?.! ]*$/i;
const CONFIRM = /^yes,?\s+(?:forget|clear|reset)\s+everything[.! ]*$/i;
const FORGET_TERM = /^(?:forget|unlearn)\s+(?:about\s+)?(?:the\s+|my\s+)?(.{2,60}?)[?.! ]*$/i;
const NOT_A_TERM = /^(?:it|that|this|them|me|him|her|about it|about that|everything|all)$/i;

export function parseLearningsCommand(input: string): LearningsCommand | null {
  const text = input.trim();
  if (CONFIRM.test(text)) return { type: "confirm_forget_all" };
  if (SHOW.test(text)) return { type: "show" };
  if (FORGET_ALL.test(text)) return { type: "forget_all" };
  const term = text.match(FORGET_TERM)?.[1]?.trim();
  return term && !NOT_A_TERM.test(term) ? { type: "forget", term } : null;
}

const TOPIC = { all: "everything", receipt: "receipts", promotion: "promotions", recruiter: "recruiter emails", general: "email" } as const;

export function describeLearning(learning: Learning) {
  switch (learning.kind) {
    case "default_window": return `Search ${TOPIC[learning.topic]} back ${learning.days} days by default`;
    case "sender_alias": return `“${learning.alias}” means ${learning.canonical} (email sender)`;
    case "default_action": return "Receipt requests show amounts (say “emails” for a plain list)";
    case "calendar_duration": return `New events last ${learning.minutes} minutes when no length is given`;
    case "calendar_buffer": return `${learning.minutes}-minute buffer on “can I make it” answers`;
    case "merchant_category": return `${learning.merchant} goes under ${learning.category}`;
    case "merchant_alias": return `“${learning.alias}” means ${learning.canonical} (merchant)`;
    case "autopay": return `${learning.merchant} bills are paid automatically (autopay)`;
    case "home_location": return `Your home location is ${learning.place}`;
  }
}

const GROUPS: Array<{ title: string; kinds: Learning["kind"][] }> = [
  { title: "Email", kinds: ["default_window", "default_action", "sender_alias"] },
  { title: "Calendar", kinds: ["calendar_duration", "calendar_buffer"] },
  { title: "Finance", kinds: ["merchant_category", "merchant_alias", "autopay"] },
  { title: "Location", kinds: ["home_location"] },
];

/** R15.1, R15.4 */
export function renderLearnings(learnings: Learning[]) {
  if (!learnings.length) {
    return "I haven't learned anything about your preferences yet. I pick things up when you correct me: “I meant Adobe”, “always search 90 days”, “iHerb is health”, “my meetings are 30 minutes by default”.";
  }
  const sections = GROUPS.flatMap(({ title, kinds }) => {
    const items = learnings.filter((learning) => kinds.includes(learning.kind));
    return items.length ? [`**${title}**\n${items.map((learning) => `- ${describeLearning(learning)}`).join("\n")}`] : [];
  });
  return `### What I've learned\n\n${sections.join("\n\n")}\n\nSay “forget adobee”, “forget the calendar buffer”, or “forget everything” to undo any of it.`;
}

/** R15.2: does "forget <term>" refer to this learning? */
export function matchesForget(learning: Learning, rawTerm: string) {
  const term = rawTerm.toLowerCase().replace(/[“”"']/g, "").trim();
  if (/\b(?:default )?(?:search )?window\b/.test(term)) return learning.kind === "default_window";
  if (/\bbuffer\b/.test(term)) return learning.kind === "calendar_buffer";
  if (/\b(?:home|location)\b/.test(term) && learning.kind === "home_location") return true;
  if (/\b(?:receipt )?amounts?\b/.test(term)) return learning.kind === "default_action";
  if (/\bauto-?pay\b/.test(term) && learning.kind === "autopay") return term.replace(/auto-?pay|bills?|the|my/g, "").trim() === "" || describeLearning(learning).toLowerCase().includes(term.replace(/auto-?pay|bills?|the|my/g, "").trim());
  if (/\b(?:event|meeting)s?\b.*\b(?:length|duration)\b|\b(?:length|duration)\b/.test(term)) return learning.kind === "calendar_duration";
  const haystack = describeLearning(learning).toLowerCase();
  const own = learning.kind === "merchant_category" ? `${learning.merchant} ${learning.category}` : learning.kind === "merchant_alias" || learning.kind === "sender_alias" ? `${learning.alias} ${learning.canonical}` : "";
  return `${haystack} ${own}`.toLowerCase().includes(term);
}

const TOPIC_SEARCH = { all: "email", receipt: "receipt searches", promotion: "promotion searches", recruiter: "recruiter searches", general: "email" } as const;

/** One confirmation line for any new learning (R11.5, R14.3). */
export function acknowledgeLearning(learning: Learning) {
  switch (learning.kind) {
    case "default_window": return `Done. I'll search ${TOPIC_SEARCH[learning.topic]} back ${learning.days} days by default from now on.`;
    case "default_action": return "Got it. From now on, a request for receipts shows the amounts. Say “emails” or “just list them” for a plain list, or “forget receipt amounts” to undo.";
    case "sender_alias": return `Got it. When you say “${learning.alias}”, I'll look for ${learning.canonical}.`;
    case "calendar_duration": return `Done. New events will last ${learning.minutes} minutes when you don't give a length.`;
    case "calendar_buffer": return `Done. I'll add a ${learning.minutes}-minute buffer when checking whether you can make something.`;
    case "merchant_category": return `Got it. ${learning.merchant} goes under ${learning.category} from now on. That applies to new records and imports; existing ones stay as they are.`;
    case "merchant_alias": return `Got it. I'll record “${learning.alias}” as ${learning.canonical} from now on.`;
    case "home_location": return `Got it. I'll use ${learning.place} as your home location. Say “forget my home location” to undo.`;
    case "autopay": return `Got it. I'll treat ${learning.merchant} bills as paid on their due date. Say “forget ${learning.merchant} autopay” to undo.`;
  }
}
