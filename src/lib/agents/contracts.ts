import { z } from "zod";

export const agentNameSchema = z.enum(["general", "calendar", "email", "finance"]);
export type AgentName = z.infer<typeof agentNameSchema>;

export const taskCriticalitySchema = z.enum(["required", "optional", "alternative"]);

export const agentTaskSchema = z.object({
  id: z.string().min(1),
  agent: agentNameSchema,
  operation: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  dependsOn: z.array(z.string()),
  criticality: taskCriticalitySchema,
  readOnly: z.boolean(),
  maxAttempts: z.number().int().min(1).max(3),
  timeoutMs: z.number().int().min(100).max(30_000),
});

export type AgentTask = z.infer<typeof agentTaskSchema>;

export const orchestrationPlanSchema = z.object({
  requestId: z.string().min(1),
  decision: z.enum(["execute", "clarify", "decline", "answer_without_tools"]),
  intents: z.array(z.object({ name: z.string(), confidence: z.number().min(0).max(1) })),
  tasks: z.array(agentTaskSchema).max(10),
  requiresApproval: z.boolean(),
  budgets: z.object({
    maxAgentCalls: z.number().int().min(0).max(10),
    maxModelCalls: z.number().int().min(0).max(4),
    maxToolCalls: z.number().int().min(0).max(16),
    maxInputTokens: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    deadlineMs: z.number().int().min(100).max(30_000),
    maximumCostUsd: z.number().nonnegative(),
  }),
});

export type OrchestrationPlan = z.infer<typeof orchestrationPlanSchema>;
