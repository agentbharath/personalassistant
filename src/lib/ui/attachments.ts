export const ATTACHMENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** Why a file can't be attached as a receipt, or null when it can. The server checks again; this only saves a round trip. */
export function attachmentProblem(file: { type: string; size: number; name: string }): string | null {
  if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) return `“${file.name}” isn’t a PDF or image (JPG, PNG or WebP).`;
  if (file.size > MAX_ATTACHMENT_BYTES) return `“${file.name}” is ${formatBytes(file.size)}. Receipts must be 5 MB or smaller.`;
  if (file.size === 0) return `“${file.name}” is empty.`;
  return null;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
