import { callClaude } from "@/lib/runtime/model-runtime";
import { createEncryptedCache } from "@/lib/runtime/encrypted-cache";
import { pickSpendingEmails, type PickableEmail } from "./spending-picker";

/** Remembered for 30 days per email, encrypted (the sender and subject are private). */
const cache = createEncryptedCache({ prefix: "spend-pick", ttlSeconds: 30 * 24 * 60 * 60 });

export function pickSpendingEmailsForUser(userId: string, emails: PickableEmail[]) {
  return pickSpendingEmails(userId, emails, { complete: (params) => callClaude("spending_picker", params, { userId }), cache });
}
