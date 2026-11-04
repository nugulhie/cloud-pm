import type { Service } from "./service";

type Data = Awaited<ReturnType<Service["dashboard"]>>;

// UI preview only. The server rechecks permissions, revisions and dependencies.
export function deletionImpact(
  data: Data,
  kind: "project" | "feature" | "task",
  ids: string[],
) {
  const tasks = new Set(
    data.tasks
      .filter(({ data: task }) =>
        ids.includes(
          kind === "project"
            ? task.project
            : kind === "feature"
              ? task.feature
              : task.id,
        ),
      )
      .map(({ data: task }) => task.id),
  );
  if (kind === "task") {
    let previousSize = -1;
    while (previousSize !== tasks.size) {
      previousSize = tasks.size;
      for (const { data: task } of data.tasks)
        if (task.parentId && tasks.has(task.parentId)) tasks.add(task.id);
    }
  }
  return {
    tasks: tasks.size,
    requirements:
      kind === "project"
        ? data.requirements.filter((row) => ids.includes(row.data.project))
            .length
        : 0,
    links: data.links.filter((row) => tasks.has(row.data.task)).length,
    blockers: data.tasks
      .filter(
        ({ data: task }) =>
          !tasks.has(task.id) && task.dependsOn?.some((id) => tasks.has(id)),
      )
      .map(({ data: task }) => task.title),
  };
}
