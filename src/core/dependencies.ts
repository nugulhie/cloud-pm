import { DomainError, type Task } from "./model";

/** 취소된 선행 작업도 완료로 간주하지 않는다. 관계를 명시적으로 해제해야 한다. */
export function pendingDependencies(task: Task, tasks: readonly Task[]) {
  if (!task.dependsOn?.length) return [];
  const byId = new Map(
    tasks.filter((t) => t.project === task.project).map((t) => [t.id, t]),
  );
  return (task.dependsOn ?? [])
    .filter((id) => byId.get(id)?.status !== "done")
    .map((id) => ({
      id,
      title: byId.get(id)?.title ?? "조회할 수 없는 선행 작업",
      status: byId.get(id)?.status ?? null,
    }));
}
export function isDependencyBlocked(task: Task, tasks: readonly Task[]) {
  return (
    task.status !== "done" &&
    task.status !== "canceled" &&
    pendingDependencies(task, tasks).length > 0
  );
}
export function validateDependencies(
  task: Task,
  tasks: readonly Task[],
  taskIndex?: ReadonlyMap<string, Task>,
) {
  const byId = taskIndex ?? new Map(tasks.map((t) => [t.id, t]));
  for (const dependency of task.dependsOn ?? []) {
    if (dependency === task.id)
      throw new DomainError("자기 자신을 선행 작업으로 지정할 수 없습니다.");
    const prerequisite = byId.get(dependency);
    if (!prerequisite || prerequisite.project !== task.project)
      throw new DomainError("같은 프로젝트에 속한 선행 작업을 선택하세요.");
  }
  if (
    tasks.some(
      (t) => t.dependsOn?.includes(task.id) && t.project !== task.project,
    )
  )
    throw new DomainError(
      "후행 작업이 있는 태스크는 의존관계 해제 후 프로젝트를 변경하세요.",
    );
  const visiting = new Set<string>(),
    complete = new Set<string>();
  const stack = [{ id: task.id, exit: false }];
  while (stack.length) {
    const frame = stack.pop()!;
    if (frame.exit) {
      visiting.delete(frame.id);
      complete.add(frame.id);
      continue;
    }
    if (complete.has(frame.id)) continue;
    if (visiting.has(frame.id))
      throw new DomainError("선행 작업을 순환 연결할 수 없습니다.");
    visiting.add(frame.id);
    stack.push({ id: frame.id, exit: true });
    const current = frame.id === task.id ? task : byId.get(frame.id);
    for (const dependency of current?.dependsOn ?? [])
      stack.push({ id: dependency, exit: false });
  }
}

export function taskDependencyInfo(task: Task, tasks: readonly Task[]) {
  const projectTasks = tasks.filter((t) => t.project === task.project);
  return {
    task: task.id,
    blocked: isDependencyBlocked(task, projectTasks),
    pending: pendingDependencies(task, projectTasks),
    predecessors: (task.dependsOn ?? []).map((id) => {
      const dependency = projectTasks.find((t) => t.id === id);
      return {
        id,
        title: dependency?.title ?? "조회할 수 없는 선행 작업",
        status: dependency?.status ?? null,
      };
    }),
    successors: projectTasks
      .filter((t) => t.dependsOn?.includes(task.id))
      .map((t) => ({ id: t.id, title: t.title, status: t.status })),
  };
}
