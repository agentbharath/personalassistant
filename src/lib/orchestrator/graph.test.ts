import { describe, expect, it } from "vitest";
import type { AgentTask } from "@/lib/agents/contracts";
import { assertAcyclic, getRunnableTasks } from "./graph";

const task = (id: string, dependsOn: string[] = []): AgentTask => ({
  id,
  agent: "general",
  operation: "test",
  input: {},
  dependsOn,
  criticality: "required",
  readOnly: true,
  maxAttempts: 1,
  timeoutMs: 1_000,
});

describe("orchestration graph", () => {
  it("returns only tasks whose dependencies completed", () => {
    const tasks = [task("search"), task("calendar", ["search"])];
    expect(getRunnableTasks(tasks, new Set())).toEqual([tasks[0]]);
    expect(getRunnableTasks(tasks, new Set(["search"]))).toEqual([tasks[1]]);
  });

  it("rejects cycles", () => {
    expect(() => assertAcyclic([task("a", ["b"]), task("b", ["a"])] )).toThrow(
      "CYCLIC_AGENT_PLAN",
    );
  });
});
