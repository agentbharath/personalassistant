import type { Message } from "@/components/chat/types";
import type { ConversationSummary } from "@/lib/conversations/store";

const now = Date.now();
const ago = (hours: number) => new Date(now - hours * 3_600_000).toISOString();

export const MOCK_RECENT: ConversationSummary[] = [
  { id: "00000000-0000-4000-8000-000000000001", title: "iHerb receipts", updatedAt: ago(1), pinned: true, pinnedAt: ago(30) },
  { id: "00000000-0000-4000-8000-000000000002", title: "Total spending so far", updatedAt: ago(3) },
  { id: "00000000-0000-4000-8000-000000000003", title: "Movie plans around meeting", updatedAt: ago(26) },
  { id: "00000000-0000-4000-8000-000000000004", title: "Email from Amazon Web Services today", updatedAt: ago(50) },
  { id: "00000000-0000-4000-8000-000000000005", title: "DoorDash receipts", updatedAt: ago(200) },
  { id: "00000000-0000-4000-8000-000000000006", title: "Outstanding bills", updatedAt: ago(700) },
];

export const MOCK_THREAD: Message[] = [
  { role: "user", content: "show my latest iherb receipts with the amounts", sequence: "1" },
  { role: "assistant", sequence: "2", content: "### Receipt amounts\n\n1. **Order Confirmed #947597212**  \n   $48.20 · Sep 15\n2. **Order Confirmed #946705324**  \n   $32.99 · Aug 14\n3. **Order Confirmed #946406863**  \n   $61.40 · Aug 3\n\n**Total: $142.59** across 3 receipts.\n\n*Searched the last 90 days for: iherb, receipt.*" },
  { role: "user", content: "import the second one", sequence: "3" },
  { role: "assistant", sequence: "4", content: "I can add this expense:\n\n- **Merchant:** iHerb\n- **Amount:** $32.99\n- **Date:** Aug 14, 2026\n\nReply **Confirm** to save it, or **Cancel**." },
  { role: "user", content: "what do I spend most on?", sequence: "5" },
  { role: "assistant", sequence: "6", content: "| Category | Total | Share |\n| --- | ---: | ---: |\n| Groceries | $412.10 | 38% |\n| Utilities | $146.30 | 14% |\n| Health | $142.59 | 13% |\n\nYour biggest category is **groceries**. Utilities is a single bill." },
  { role: "assistant", notice: true, retryable: true, content: "This is taking longer than expected, so I stopped safely. Nothing unconfirmed was changed." },
];
