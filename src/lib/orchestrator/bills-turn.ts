import { Temporal } from "@js-temporal/polyfill";
import { runBillsCommand } from "@/lib/agents/bills-agent";
import { parseBillsCommand } from "@/lib/agents/bills";

const TIME_ZONE = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";

/** R17.5, R17.6, R17.8: "I paid the PG&E bill", "PG&E is on autopay", "what bills are outstanding". Deterministic, no model. */
export async function handleBillsTurn(input: string, userId: string) {
  const command = parseBillsCommand(input, Temporal.Now.zonedDateTimeISO(TIME_ZONE).toPlainDate().toString());
  return command ? { answer: await runBillsCommand(command, userId), agents: ["finance" as const], status: "completed" as const } : null;
}
