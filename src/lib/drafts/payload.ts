import type { DraftSpec } from "./mime";

/** What an approved draft action will do. Stored (encrypted) with the approval, so Confirm does exactly what the preview showed. */
export type DraftPayload =
  /** `replaces` is an earlier Daylark draft on the same email thread, deleted after this one is saved (unless the person edited it in Gmail). */
  | { action: "create"; spec: DraftSpec; replaces?: string }
  | { action: "edit"; draftId: string; subject: string; body: string }
  | { action: "revert"; draftId: string; versionIndex: number }
  | { action: "discard"; draftId: string };
