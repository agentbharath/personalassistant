import type { DraftSpec } from "./mime";

/** What an approved draft action will do. Stored (encrypted) with the approval, so Confirm does exactly what the preview showed. */
export type DraftPayload =
  | { action: "create"; spec: DraftSpec }
  | { action: "edit"; draftId: string; subject: string; body: string }
  | { action: "revert"; draftId: string; versionIndex: number }
  | { action: "discard"; draftId: string };
