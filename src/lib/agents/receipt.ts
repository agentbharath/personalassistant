import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { extractTransactionFromEvidence } from "@/lib/model/claude";
import { NO_LEARNINGS } from "@/lib/learning/learnings";
import { applyMerchantLearnings } from "@/lib/learning/preferences";
import { loadLearnings } from "@/lib/learning/store";
import { createFinanceImportApproval } from "@/lib/workflows/finance-import";

const TIME_ZONE = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";
const SUPPORTED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export async function prepareReceiptImport(file: File, userId: string, conversationId: string) {
  if (!SUPPORTED_TYPES.has(file.type)) return "Use a PDF, JPEG, PNG, or WebP receipt.";
  if (file.size > 5_000_000) return "That receipt is larger than 5 MB. Nothing was uploaded or imported.";
  const bytes = Buffer.from(await file.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("base64url");
  const today = Temporal.Now.zonedDateTimeISO(TIME_ZONE).toPlainDate().toString();
  const extracted = await extractTransactionFromEvidence(
    `Uploaded receipt filename: ${file.name}`,
    today,
    { data: bytes.toString("base64"), mediaType: file.type as "application/pdf" | "image/jpeg" | "image/png" | "image/webp" },
  );
  const missing = [!extracted.amountMinor && "total", !extracted.merchant && "merchant", !extracted.occurredOn && "date"].filter(Boolean) as string[];
  if (!extracted.isTransaction || missing.length) {
    return `I couldn’t reliably identify the ${joinWords(missing.length ? missing : ["receipt details"])}. The file was not stored and nothing was imported.`;
  }
  const candidate = applyMerchantLearnings({
    occurredOn: extracted.occurredOn!,
    amountMinor: extracted.amountMinor!,
    currency: extracted.currency ?? "USD",
    direction: extracted.direction ?? "expense" as const,
    merchant: extracted.merchant!,
    category: extracted.category ?? "other",
    note: extracted.note,
  }, await loadLearnings(userId).catch(() => NO_LEARNINGS)).candidate;
  await createFinanceImportApproval(userId, conversationId, {
    candidate,
    source: {
      type: "receipt",
      externalRef: digest,
      payload: JSON.stringify({ filename: file.name, mimeType: file.type, size: file.size }),
    },
  });
  return `### Review receipt import\n\n- **Merchant:** ${candidate.merchant}\n- **Amount:** ${formatMoney(candidate.amountMinor, candidate.currency)}\n- **Date:** ${candidate.occurredOn}\n- **Category:** ${candidate.category}\n- **Source:** ${file.name}\n\nChoose **Confirm** to import it or **Cancel** to leave your finances unchanged. The raw receipt was not stored, and this preview expires in 30 minutes.`;
}

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100);
}
function joinWords(values: string[]) { return values.length < 2 ? values[0] : `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`; }
