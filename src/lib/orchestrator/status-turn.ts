import { answerStatusLookup, parseStatusLookup } from "@/lib/agents/status-lookup";

/** R18.1: rule-based, no model. */
export async function handleStatusLookup(input: string, userId: string) {
  const lookup = parseStatusLookup(input);
  return lookup ? { answer: await answerStatusLookup(userId, lookup), agents: ["email" as const], status: "completed" as const } : null;
}
