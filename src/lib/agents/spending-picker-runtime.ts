import { callClaude } from "@/lib/runtime/model-runtime";
import { createEncryptedCache } from "@/lib/runtime/encrypted-cache";
import { pickSpendingEmails, type FinancialEmailMode, type PickableEmail } from "./spending-picker";

/** Remembered for 30 days per email, encrypted (the sender and subject are private). */
const cache = createEncryptedCache({ prefix: "spend-pick", ttlSeconds: 30 * 24 * 60 * 60, memoryLimit: 5000 });

export function pickSpendingEmailsForUser(userId: string, emails: PickableEmail[], mode: FinancialEmailMode = "spending") {
  return pickSpendingEmails(userId, emails, { complete: (params) => callClaude("spending_picker", params, { userId }), cache }, mode);
}
