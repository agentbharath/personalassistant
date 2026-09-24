export type Message = {
  role: "user" | "assistant";
  content: string;
  retryable?: boolean;
  /** Set on messages that report a problem (rate limit, timeout, outage), so they render as a notice, not an answer. */
  notice?: boolean;
  sequence?: string;
  /** Which agents produced this answer; only known for answers received in this session. */
  agents?: string[];
  status?: string;
  /** Tap-to-answer options for a question Daylark just asked. */
  choices?: string[];
};

export function hasApprovalActions(content: string) {
  return content.includes("**Confirm**") || /reply\s+\*\*confirm\*\*/i.test(content);
}

const AGENT_PROGRESS: Record<string, string> = {
  email: "Checking your email…",
  calendar: "Checking your calendar…",
  finance: "Looking at your spending…",
  general: "Searching the web…",
};

/** What Daylark is doing right now, from the agents the server reports as running. */
export function progressLabel(agents: string[]) {
  const known = agents.map((agent) => AGENT_PROGRESS[agent]).filter(Boolean);
  return known.length ? known.join(" ") : "Understanding your request…";
}

/** Do not infer follow-up suggestions from an agent name: an email answer may be a work order, not a receipt. */
export function followUps(_message: Message | undefined): string[] { return []; }

/** The options to show under a question Daylark just asked. Only for a live question with a few answers; free text always still works. */
export function answerChoices(message: Message | undefined) {
  if (!message || message.role !== "assistant" || message.notice || (message.status !== undefined && message.status !== "waiting_for_user")) return [];
  return (message.choices ?? []).filter((choice) => choice.trim().length > 0).slice(0, 8);
}

export function hasScanActions(content: string) { return content.includes("**Continue scan**"); }
