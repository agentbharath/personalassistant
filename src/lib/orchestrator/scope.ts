type ContextMessage = { role: "user" | "assistant"; content: string };

export const SCOPE_REFUSAL = "That’s outside Daylark’s scope. I can help with public web searches, your finances, your email, or your calendar.";

const selfHarmIntent = /\b(?:i\s+(?:want|plan|intend|might|am going|feel like|could)\s+to\s+(?:kill|hurt|harm)\s+myself|i\s+(?:want|plan|intend|might|am going|feel like|could)\s+to\s+end\s+my\s+life|i(?:'m| am)\s+suicidal|should i kill myself)\b/i;
const otherHarmIntent = /\b(?:i\s+(?:want|plan|intend|might|am going|feel like|could)\s+to\s+(?:kill|hurt|harm|attack|shoot|stab)\s+(?:him|her|them|someone|people|my\s+\w+)|i(?:'m| am)\s+going\s+to\s+(?:kill|hurt|harm|attack|shoot|stab))\b/i;

const outOfScope = [
  /\b(?:dating|relationship|boyfriend|girlfriend|husband|wife|marriage|divorce|adultery|affair|sex|sexual|partner|hot girls?|find (?:a )?(?:girl|guy|man|woman))\b/i,
  /\b(?:bored|lonely|sad|unhappy|anxious|depressed|overwhelmed|hopeless|emotion|feelings?|what(?:'s| is) wrong with me|my life)\b/i,
  /\b(?:violence|violent|abuse|abusive|assault|weapon|bomb|explosive|kill|murder|suicide|self[- ]?harm|distress)\b/i,
  /\b(?:code|coding|programming|python|javascript|typescript|java|c\+\+|sql|debug|software|algorithm|api)\b/i,
  /\b(?:homework|teach me|explain|lesson|study|school|college|university|research paper|academic|essay|solve this equation)\b/i,
  /\b(?:generate|create|draw|edit|make)\s+(?:an?\s+)?(?:image|photo|picture|illustration|logo|video)\b/i,
  /\b(?:medical advice|legal advice|therapy|therapist|diagnose|symptom|medication)\b/i,
];

export type CapabilityBridge = { capability: "web" | "finance" | "email" | "calendar"; answer: string };

export type CasualKind = "greeting" | "banter" | "capabilities" | "rude" | "boundary";

export function classifyCasualMessage(input: string): CasualKind | null {
  const normalized = input.trim().toLowerCase();
  const rude = /\b(?:asshole|idiot|stupid|moron|fuck you|shut up)\b/i.test(input);
  const asksScope = /\b(?:what(?:'s| is) (?:in )?your scope|what (?:can|do) you do|how can you help|your capabilities)\b/i.test(input);
  if (rude) return "rude";
  if (asksScope) return "capabilities";
  if (/^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening))[!,. ]*$/i.test(normalized)) return "greeting";
  if (/^(?:come on[, ]*)?(?:let(?:'s| us) chill|chill|hang out|talk to me)(?:\s+(?:bro|dude|man))?[.! ]*$/i.test(normalized)) return "banter";
  if (/^(?:how are you(?: doing)?(?: today)?|how(?:'s| is) it going|what(?:'s| is) up|thanks|thank you|nice|cool|great|awesome)[?!. ]*$/i.test(normalized)) return "banter";
  return null;
}

export function capabilityBridge(input: string): CapabilityBridge | null {
  if (/\b(?:bored|nothing to do|restless|lonely)\b/i.test(input)) {
    return { capability: "web", answer: "Hmm—want me to search for fun things happening near you?" };
  }
  if (/\b(?:not rich enough|money (?:stress|worry|worried|anxiety)|financially stressed|can(?:not|'t) afford|broke)\b/i.test(input)) {
    return { capability: "finance", answer: "Money can feel vague until we put numbers around it. Want me to review your recent spending and recurring bills?" };
  }
  if (/\b(?:too busy|overwhelmed by (?:my )?(?:day|week|schedule)|no time|schedule is overwhelming)\b/i.test(input)) {
    return { capability: "calendar", answer: "Want me to look at your calendar and find where the pressure is coming from?" };
  }
  if (/\b(?:worried about (?:an )?email|anxious about (?:my )?inbox|missed an? (?:email|message)|waiting (?:for|on) an? (?:email|reply))\b/i.test(input)) {
    return { capability: "email", answer: "Want me to check your email for the message or reply you’re waiting on?" };
  }
  return null;
}

export function acceptedCapabilityBridge(input: string, context: ContextMessage[]) {
  if (!/^(?:yes|yeah|yep|sure|okay|ok|please|do it|go ahead)[.! ]*$/i.test(input.trim())) return null;
  const lastAssistant = [...context].reverse().find((message) => message.role === "assistant")?.content ?? "";
  if (/search for fun things happening near you/i.test(lastAssistant)) return { capability: "web" as const };
  if (/review your recent spending and recurring bills/i.test(lastAssistant)) return { capability: "finance" as const };
  if (/look at your calendar and find where the pressure/i.test(lastAssistant)) return { capability: "calendar" as const };
  if (/check your email for the message or reply/i.test(lastAssistant)) return { capability: "email" as const };
  return null;
}

export function pendingWebBridgeLocation(input: string, context: ContextMessage[]) {
  const lastAssistant = [...context].reverse().find((message) => message.role === "assistant")?.content ?? "";
  if (!/What city or ZIP code should I search around\?/i.test(lastAssistant)) return null;
  const location = input.trim();
  if (location.length < 2 || location.length > 100) return null;
  return `Fun activities and events happening near ${location}`;
}

/** The fixed, careful crisis text. A model decides when to show it; this is what is shown. */
export const CRISIS_RESPONSE = "I’m sorry you’re dealing with this. I can’t help with harming yourself or someone else. If anyone may be in immediate danger, call local emergency services now. In the U.S. or Canada, call or text 988 for immediate crisis support. Move away from any weapon or dangerous item, and contact someone you trust who can stay with you. Are you or anyone else in immediate danger right now?";

export function crisisResponse(input: string) {
  if (!selfHarmIntent.test(input) && !otherHarmIntent.test(input)) return null;
  return CRISIS_RESPONSE;
}

export function outOfScopeResponse(input: string, _context: ContextMessage[] = []) {
  return outOfScope.some((pattern) => pattern.test(input)) ? SCOPE_REFUSAL : null;
}
