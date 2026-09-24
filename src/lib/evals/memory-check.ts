import type { ExtractedMemory } from "@/lib/memory/extractor";

export type MemoryExpect = {
  count: number;
  type?: string;
  category?: string;
  strength?: string;
  stated?: boolean;
  action?: string;
  supersedes?: string | null;
  statementIncludes?: string;
  statementExcludes?: string;
  validUntilIncludes?: string;
};

/** Compares the extractor's real output with what a case expects. Returns the problems found; an empty list means it passed. */
export function checkMemoryCandidates(candidates: ExtractedMemory[], want: MemoryExpect): string[] {
  const problems: string[] = [];
  if (candidates.length !== want.count) problems.push(`count: wanted ${want.count}, got ${candidates.length} (${candidates.map((c) => `${c.type}/${c.statement}`).join("; ")})`);
  if (want.count === 0) return problems;
  const candidate = candidates[0];
  if (want.type && candidate.type !== want.type) problems.push(`type: wanted ${want.type}, got ${candidate.type}`);
  if (want.category && candidate.category !== want.category) problems.push(`category: wanted ${want.category}, got ${candidate.category}`);
  if (want.strength && candidate.strength !== want.strength) problems.push(`strength: wanted ${want.strength}, got ${candidate.strength}`);
  if (want.stated !== undefined && candidate.stated !== want.stated) problems.push(`stated: wanted ${want.stated}, got ${candidate.stated}`);
  if (want.action && candidate.action !== want.action) problems.push(`action: wanted ${want.action}, got ${candidate.action}`);
  if (want.supersedes !== undefined && candidate.supersedes !== want.supersedes) problems.push(`supersedes: wanted ${want.supersedes}, got ${candidate.supersedes}`);
  if (want.statementIncludes && !candidate.statement.toLowerCase().includes(want.statementIncludes.toLowerCase())) problems.push(`statement: wanted it to include "${want.statementIncludes}", got "${candidate.statement}"`);
  if (want.statementExcludes && candidate.statement.toLowerCase().includes(want.statementExcludes.toLowerCase())) problems.push(`statement: should not include "${want.statementExcludes}", got "${candidate.statement}"`);
  if (want.validUntilIncludes && !(candidate.validUntil ?? "").includes(want.validUntilIncludes)) problems.push(`validUntil: wanted it to include "${want.validUntilIncludes}", got ${JSON.stringify(candidate.validUntil)}`);
  return problems;
}
