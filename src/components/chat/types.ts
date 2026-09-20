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

/** Fixed next-step suggestions by which agents answered. They are sent as ordinary messages and interpreted like any other. */
const FOLLOW_UPS: Record<string, string[]> = {
  email: ["Show the amounts", "Search the last 7 days", "Only unread ones"],
  calendar: ["What’s on tomorrow?", "Find a free hour this week"],
  finance: ["Break it down by category", "What bills are outstanding?"],
};

export function followUps(message: Message | undefined) {
  if (!message || message.role !== "assistant" || message.notice || message.status !== "completed") return [];
  const agent = message.agents?.find((name) => FOLLOW_UPS[name]);
  return agent ? FOLLOW_UPS[agent] : [];
}
