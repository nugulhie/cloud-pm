import type { Stored, Task } from "./model";

export function taskHierarchyIndex(tasks: readonly Stored<Task>[]) {
  const byId = new Map(tasks.map((task) => [task.data.id, task]));
  const children = new Map<string, Stored<Task>[]>();
  const roots: Stored<Task>[] = [];
  for (const task of tasks) {
    const parent = task.data.parentId;
    if (!parent || !byId.has(parent)) roots.push(task);
    else {
      const siblings = children.get(parent) ?? [];
      siblings.push(task);
      children.set(parent, siblings);
    }
  }
  // 과거 데이터에 순환이 있어도 목록을 멈추거나 작업을 숨기지 않는다.
  const covered = new Set<string>();
  const cover = (root: Stored<Task>) => {
    const pending = [root];
    while (pending.length) {
      const row = pending.pop()!;
      if (covered.has(row.data.id)) continue;
      covered.add(row.data.id);
      for (const child of children.get(row.data.id) ?? []) pending.push(child);
    }
  };
  for (const root of roots) cover(root);
  for (const task of tasks)
    if (!covered.has(task.data.id)) {
      roots.push(task);
      cover(task);
    }
  return { byId, children, roots };
}

export type TaskHierarchyIndex = ReturnType<typeof taskHierarchyIndex>;
export function taskDescendants(index: TaskHierarchyIndex, id: string) {
  const found = new Set<string>([id]);
  const pending = [...(index.children.get(id) ?? [])];
  while (pending.length) {
    const task = pending.pop()!;
    if (found.has(task.data.id)) continue;
    found.add(task.data.id);
    for (const child of index.children.get(task.data.id) ?? [])
      pending.push(child);
  }
  found.delete(id);
  return found;
}

export type HierarchyRow =
  | { kind: "task"; task: Stored<Task>; depth: number }
  | {
      kind: "more";
      parentId: string;
      depth: number;
      shown: number;
      total: number;
    };
export function visibleTaskHierarchy(
  index: TaskHierarchyIndex,
  expanded: ReadonlySet<string>,
  childLimits: ReadonlyMap<string, number>,
  rootLimit = 50,
) {
  const pending: HierarchyRow[] = index.roots
    .slice(0, rootLimit)
    .reverse()
    .map((task) => ({ kind: "task", task, depth: 0 }));
  const rows: HierarchyRow[] = [];
  const seen = new Set<string>();
  while (pending.length) {
    const row = pending.pop()!;
    if (row.kind === "more") {
      rows.push(row);
      continue;
    }
    const id = row.task.data.id;
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push(row);
    if (!expanded.has(id)) continue;
    const children = index.children.get(id) ?? [];
    const limit = childLimits.get(id) ?? 50;
    if (children.length > limit)
      pending.push({
        kind: "more",
        parentId: id,
        depth: row.depth + 1,
        shown: limit,
        total: children.length,
      });
    for (
      let position = Math.min(limit, children.length) - 1;
      position >= 0;
      position--
    )
      pending.push({
        kind: "task",
        task: children[position]!,
        depth: row.depth + 1,
      });
  }
  return rows;
}
