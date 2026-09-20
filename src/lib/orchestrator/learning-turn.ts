import { acknowledgeLearning, describeLearning, matchesForget, parseLearningsCommand, renderLearnings, type LearningsCommand } from "@/lib/learning/commands";
import { CATEGORIES, detectCalendarPreference, detectFinanceCorrection } from "@/lib/learning/preferences";
import { deleteAllLearnings, deleteLearnings, listLearnings, saveLearning } from "@/lib/learning/store";
import type { Learning } from "@/lib/learning/learnings";

export type LearningTurn = { answer: string; agents: Array<"email" | "calendar" | "finance">; status: "completed" | "waiting_for_user" };

async function teach(userId: string, learning: Learning, agent: "calendar" | "finance"): Promise<LearningTurn> {
  try {
    await saveLearning(userId, learning);
    return { answer: acknowledgeLearning(learning), agents: [agent], status: "completed" };
  } catch {
    return { answer: "I couldn't save that just now, so I won't remember it next time. Try again in a moment.", agents: [agent], status: "completed" };
  }
}

/**
 * R14, R15: explicit calendar and finance corrections, and viewing or forgetting what was learned.
 * Email corrections need the last search, so they live in the email turn.
 */
export async function runLearningCommand(command: LearningsCommand, userId: string): Promise<LearningTurn> {
  const all = await listLearnings(userId);
  if (command.type === "show") return { answer: renderLearnings(all), agents: [], status: "completed" };
  if (command.type === "forget_all") {
    return all.length
      ? { answer: `That would clear ${all.length} thing${all.length === 1 ? "" : "s"} I've learned. Nothing has changed yet. Say “yes, forget everything” to confirm.`, agents: [], status: "waiting_for_user" }
      : { answer: renderLearnings([]), agents: [], status: "completed" };
  }
  if (command.type === "confirm_forget_all") {
    await deleteAllLearnings(userId);
    return { answer: all.length ? `Done. I've forgotten all ${all.length}. I'm back to defaults.` : "There was nothing to forget.", agents: [], status: "completed" };
  }
  const matches = all.filter((learning) => matchesForget(learning, command.term));
  if (!matches.length) return { answer: `I haven't learned anything about “${command.term}”. Say “what have you learned” to see what I have.`, agents: [], status: "completed" };
  await deleteLearnings(userId, matches);
  return { answer: `Forgot:\n${matches.map((learning) => `- ${describeLearning(learning)}`).join("\n")}`, agents: [], status: "completed" };
}

export async function handleLearningTurn(input: string, userId: string): Promise<LearningTurn | null> {
  const command = parseLearningsCommand(input);
  if (command) return runLearningCommand(command, userId);

  const calendar = detectCalendarPreference(input);
  if (calendar) return teach(userId, calendar, "calendar");

  const finance = detectFinanceCorrection(input);
  if (finance) {
    if ("unknownCategory" in finance) {
      return { answer: `I don't have a “${finance.unknownCategory}” category. Which should ${finance.merchant} go under: ${CATEGORIES.join(", ")}?`, agents: ["finance"], status: "waiting_for_user" };
    }
    return teach(userId, finance, "finance");
  }
  return null;
}
