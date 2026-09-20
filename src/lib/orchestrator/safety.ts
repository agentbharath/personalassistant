type ContextMessage = { role: "user" | "assistant"; content: string };

const explosiveConstruction = /\b(?:how (?:do|can|would) (?:i|you)|tell me how to|instructions? (?:for|to)|help me)\s+(?:make|build|create|assemble|manufacture)\s+(?:a\s+)?(?:bomb|explosive|ied|pipe bomb|firework|cracker)s?\b/i;
const directExplosiveConstruction = /\b(?:make|build|create|assemble|manufacture)\s+(?:a\s+)?(?:bomb|explosive|ied|pipe bomb)\b/i;
const benignSafetyContext = /\b(?:history|news|movie|fiction|novel|definition|detect|dispose|report|evacuate|safety|safe distance|emergency|threat)\b/i;

export function dangerousRequestRefusal(input: string, context: ContextMessage[]) {
  const current = input.trim();
  const directRequest = (explosiveConstruction.test(current) || directExplosiveConstruction.test(current)) && !benignSafetyContext.test(current);
  const lastUserRequest = [...context].reverse().find((message) => message.role === "user")?.content ?? "";
  const dangerousFollowUp = /\b(?:for|with|using)?\s*(?:diwali|festival)?\s*(?:fireworks?|crackers?)\b/i.test(current)
    && (explosiveConstruction.test(lastUserRequest) || directExplosiveConstruction.test(lastUserRequest));

  if (!directRequest && !dangerousFollowUp) return null;
  return "No—I can’t help make explosives or modify fireworks. I can help with legal, commercially manufactured fireworks, local rules, and safe handling instead.";
}


/** Shown when the router decides a request is dangerous. The fallback rules above use a more specific text for explosives. */
export const UNSAFE_REFUSAL = "I can’t help with that. If you tell me what you’re trying to achieve, I can help with a safe way to do it.";
