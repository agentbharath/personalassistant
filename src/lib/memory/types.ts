export const MEMORY_TYPES = ["fact", "preference", "rule"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_STRENGTHS = ["hard", "soft"] as const;
export type MemoryStrength = (typeof MEMORY_STRENGTHS)[number];

export const MEMORY_STATUSES = ["active", "pending", "superseded", "expired", "rejected"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const MEMORY_CATEGORIES = ["diet", "health", "work", "finance", "email", "calendar", "travel", "household", "general"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export type Memory = {
  id: string;
  type: MemoryType;
  category: MemoryCategory;
  strength: MemoryStrength;
  statement: string;
  status: MemoryStatus;
  supersededBy: string | null;
  /** ISO date. Null means it never expires on its own. */
  validUntil: string | null;
  createdAt: string;
};
