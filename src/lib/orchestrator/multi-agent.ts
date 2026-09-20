import { answerCalendar } from "@/lib/agents/calendar";
import { answerEmail } from "@/lib/agents/email";
import { answerFinance } from "@/lib/agents/finance";
import { answerPublicSearch } from "@/lib/agents/general";
import { prepareAgentStage } from "@/lib/runtime/query-budget";
import { isPublicSearchQuery } from "./routing";

type AgentName = "general" | "calendar" | "email" | "finance";
type ContextMessage = { role: "user" | "assistant"; content: string };
type AgentTask = { agent: AgentName; instruction: string };
export type AgentOutcome = { agent: AgentName; ok: boolean; answer?: string };

/** Executes only read-only generic tasks. Mutations remain in their approval-gated workflows. */
export async function executeReadOnlyAgentPlan(tasks: AgentTask[], input: string, userId: string, context: ContextMessage[]) {
  const unique = [...new Map(tasks.map((task) => [task.agent, task])).values()];
  const executions = unique.map((task) => {
    prepareAgentStage([task.agent], task.agent === "general" ? "balanced" : "fast");
    return executeTask(task, input, userId, context);
  });
  const settled = await Promise.allSettled(executions);
  return settled.map<AgentOutcome>((result, index) => result.status === "fulfilled"
    ? { agent: unique[index].agent, ok: true, answer: result.value }
    : { agent: unique[index].agent, ok: false });
}

async function executeTask(task: AgentTask, input: string, userId: string, context: ContextMessage[]) {
  const instruction = task.instruction.trim() || input;
  if (task.agent === "calendar") return answerCalendar(instruction, userId);
  if (task.agent === "email") return answerEmail(instruction, userId);
  if (task.agent === "finance") {
    if (!/\b(how much|total|summary|summarize|spending|spendings|transactions?|what did i spend|what are my)\b/i.test(instruction)) {
      return "This finance step may change stored data, so it was not run as part of an automatic multi-agent plan. Ask for it separately to review the action.";
    }
    return answerFinance(instruction, userId);
  }
  return answerPublicSearch(instruction);
}

export function composeMultiAgentAnswer(outcomes: AgentOutcome[]) {
  const completed = outcomes.filter((outcome) => outcome.ok && outcome.answer);
  const failed = outcomes.filter((outcome) => !outcome.ok);
  if (!completed.length) return "I couldn’t complete any part of that request. Nothing was changed; please retry.";
  const sections = completed.map((outcome) => `### ${label(outcome.agent)}\n\n${outcome.answer}`);
  if (failed.length) sections.push(`> I couldn’t complete the ${failed.map((outcome) => label(outcome.agent).toLowerCase()).join(" and ")} part${failed.length > 1 ? "s" : ""}. The results above are still valid; you can retry the missing part.`);
  return sections.join("\n\n");
}

function label(agent: AgentName) { return agent[0].toUpperCase() + agent.slice(1); }

const SIGNALS: Record<AgentName, (clause: string) => boolean> = {
  calendar: (clause) => /\b(calendar|meeting|meetings|free|available|availability|schedule)\b/i.test(clause),
  email: (clause) => /\b(email|emails|mail|inbox|receipts?|invoices?|tickets?|recruiters?)\b/i.test(clause),
  finance: (clause) => /\b(spend|spent|spending|transactions?|expense|finances?)\b/i.test(clause),
  general: (clause) => isPublicSearchQuery(clause),
};
const HAS_DATE = /\b(today|tonight|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next|this|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b|\d{1,2}[/-]\d{1,2}/i;

/** Gives each agent only its own clause, so one agent never answers (or refuses) another agent's part. */
export function planClauseInstructions(input: string, agents: AgentName[]) {
  const clauses = input.split(/\s*(?:,|;|\band\b)\s*/i).map((clause) => clause.replace(/[?.!]+$/, "").trim()).filter(Boolean);
  const notes: string[] = [];
  const tasks: AgentTask[] = [];
  for (const agent of agents) {
    const matched = clauses.filter((clause) => SIGNALS[agent](clause));
    const instruction = matched.length ? matched.join(", ") : input;
    if (agent === "calendar" && agents.includes("general") && !HAS_DATE.test(instruction)) {
      notes.push("I’ll check your calendar once the date is settled. Ask, for example, “Am I free on that date at 7 PM?”");
      continue;
    }
    tasks.push({ agent, instruction });
  }
  const invitee = input.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0];
  if (invitee && /\binvite\b/i.test(input)) notes.push(`To send the invitation, tell me the event and I’ll prepare it for your approval: “Add it to my calendar and invite ${invitee}”.`);
  return { tasks, notes };
}
