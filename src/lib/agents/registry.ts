import type { AgentName } from "./contracts";

export const AGENT_TOOLS: Readonly<Record<AgentName, readonly string[]>> = {
  general: ["web.search", "web.fetch", "source.compare", "event.verify", "memory.read", "memory.write", "memory.forget"],
  calendar: [
    "calendar.list_events",
    "calendar.free_busy",
    "calendar.create_event",
    "calendar.update_event",
    "calendar.delete_event_approved",
    "places.resolve",
    "routes.calculate",
    "schedule.calculate_feasibility",
  ],
  email: [
    "email.search",
    "email.read",
    "email.get_thread",
    "email.extract_receipt",
  ],
  finance: [
    "document.ocr",
    "receipt.extract",
    "finance.create_candidate",
    "finance.find_similar_transactions",
    "finance.score_duplicate",
    "finance.link_sources",
    "finance.aggregate",
    "finance.create_bill",
    "finance.list_bills",
    "finance.settle_bill",
  ],
};

export const DESTRUCTIVE_TOOLS = new Set([
  "email.delete",
  "email.empty_trash",
  "calendar.delete_event",
  "finance.delete_transaction",
  "finance.delete_source",
  "storage.delete_object",
]);

export function assertToolAllowed(agent: AgentName, tool: string): void {
  if (DESTRUCTIVE_TOOLS.has(tool) || !AGENT_TOOLS[agent].includes(tool)) {
    throw new Error("TOOL_NOT_ALLOWED");
  }
}
