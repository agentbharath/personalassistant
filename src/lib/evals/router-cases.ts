import { z } from "zod";
import { OPERATIONS } from "@/lib/orchestrator/router";
import type { RouterExpect } from "./router-check";

const caseSchema = z.object({
  id: z.string().min(1), rule: z.string().min(1), input: z.string().min(1),
  pending: z.boolean().optional(), home: z.string().optional(),
  search: z.object({ query: z.string(), places: z.array(z.object({ name: z.string(), address: z.string() })) }).optional(),
  state: z.object({ topic: z.string(), sender: z.string(), action: z.string(), results: z.number().int().nonnegative() }).optional(),
  context: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).optional(),
  expect: z.object({ operation: z.enum(OPERATIONS) }).passthrough(),
}).passthrough();
export type RouterCase = z.infer<typeof caseSchema> & { expect: RouterExpect };

/** Validate the entire fixture before filtering or spending; duplicate IDs corrupt incremental verification. */
export function parseRouterCases(text: string): RouterCase[] {
  const ids = new Set<string>();
  return text.trim().split("\n").map((line, index) => {
    const item = caseSchema.parse(JSON.parse(line));
    if (ids.has(item.id)) throw new Error(`Duplicate router case ID at line ${index + 1}: ${item.id}`);
    ids.add(item.id);
    return item as RouterCase;
  });
}

/** Eval fixtures are synthetic. Keep provider diagnostics here, never in production chat logs. */
export function routerEvalError(error: unknown): string {
  if (!error || typeof error !== "object") return "Unknown model request failure";
  const value = error as { status?: number; request_id?: string; message?: string; error?: { error?: { message?: string }; message?: string } };
  const detail = value.error?.error?.message ?? value.error?.message ?? value.message ?? "No provider detail";
  return JSON.stringify({ status: value.status, requestId: value.request_id, detail: detail.slice(0, 1200) });
}
