/**
 * Prioritized deferred startup tasks.
 * critical → high → normal → low; server is already listening when these run.
 */

export type StartupPriority = "critical" | "high" | "normal" | "low";

type Task = {
  name: string;
  priority: StartupPriority;
  run: () => void | Promise<void>;
};

const ORDER: StartupPriority[] = ["critical", "high", "normal", "low"];

const tasks: Task[] = [];

export function registerStartupTask(
  name: string,
  priority: StartupPriority,
  run: () => void | Promise<void>,
): void {
  tasks.push({ name, priority, run });
}

export async function runStartupTasks(): Promise<void> {
  const { child } = await import("./logger");
  const log = child({ module: "startup-tasks" });

  for (const priority of ORDER) {
    const batch = tasks.filter((t) => t.priority === priority);
    if (batch.length === 0) continue;
    log.info(`Running ${batch.length} ${priority} startup task(s)`);
    for (const task of batch) {
      try {
        await task.run();
      } catch (err) {
        log.error({ err }, `Startup task failed: ${task.name}`);
      }
    }
  }
}
