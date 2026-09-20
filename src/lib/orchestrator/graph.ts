import type { AgentTask } from "@/lib/agents/contracts";

export function getRunnableTasks(tasks: AgentTask[], completedTaskIds: Set<string>): AgentTask[] {
  return tasks.filter(
    (task) =>
      !completedTaskIds.has(task.id) &&
      task.dependsOn.every((dependencyId) => completedTaskIds.has(dependencyId)),
  );
}

export function assertAcyclic(tasks: AgentTask[]): void {
  const dependencies = new Map(tasks.map((task) => [task.id, task.dependsOn]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(taskId: string): void {
    if (visiting.has(taskId)) throw new Error("CYCLIC_AGENT_PLAN");
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    for (const dependencyId of dependencies.get(taskId) ?? []) {
      if (!dependencies.has(dependencyId)) throw new Error("MISSING_TASK_DEPENDENCY");
      visit(dependencyId);
    }
    visiting.delete(taskId);
    visited.add(taskId);
  }

  for (const task of tasks) visit(task.id);
}
