import type { Task } from "./model";

export function taskToday(now = new Date()) {
  return now.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

export function taskIsOverdue(
  task: Pick<Task, "dueDate" | "status">,
  now = new Date(),
) {
  return (
    !!task.dueDate &&
    task.dueDate < taskToday(now) &&
    !["done", "canceled"].includes(task.status)
  );
}
