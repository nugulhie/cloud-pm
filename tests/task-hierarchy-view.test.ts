import test from "node:test";
import assert from "node:assert/strict";
import { taskSchema, type Stored, type Task } from "../src/core/model";
import {
  taskHierarchyIndex,
  taskDescendants,
  visibleTaskHierarchy,
} from "../src/core/task-hierarchy";
const row = (
  id: string,
  parentId: string | null = null,
  status: Task["status"] = "backlog",
): Stored<Task> => ({
  data: taskSchema.parse({ id, project: "p", title: id, parentId, status }),
  revision: 1,
  updatedAt: "2026-10-30T00:00:00Z",
});

test("Asana처럼 순서가 섞인 작업도 상위 아래에 표시하고 접기·중첩·완료 개수를 보존한다", () => {
  const tasks = [
    row("grandchild", "child"),
    row("child", "parent", "done"),
    row("sibling", "parent"),
    row("parent"),
  ];
  const index = taskHierarchyIndex(tasks);
  assert.deepEqual(
    index.roots.map((task) => task.data.id),
    ["parent"],
  );
  assert.deepEqual(
    visibleTaskHierarchy(index, new Set(), new Map()).map(
      (r) => r.kind === "task" && r.task.data.id,
    ),
    ["parent"],
  );
  const expanded = visibleTaskHierarchy(
    index,
    new Set(["parent", "child"]),
    new Map(),
  );
  assert.deepEqual(
    expanded.map((r) => r.kind === "task" && [r.task.data.id, r.depth]),
    [
      ["parent", 0],
      ["child", 1],
      ["grandchild", 2],
      ["sibling", 1],
    ],
  );
  assert.equal(
    index.children.get("parent")!.filter((task) => task.data.status === "done")
      .length,
    1,
  );
  assert.deepEqual([...taskDescendants(index, "parent")].sort(), [
    "child",
    "grandchild",
    "sibling",
  ]);
  assert.equal(index.byId.get("parent")!.data.status, "backlog");
});

test("검색으로 상위가 빠져도 일치한 하위를 숨기지 않고 과거 순환 데이터에서 멈추지 않는다", () => {
  const filtered = taskHierarchyIndex([
    row("matching-child", "filtered-parent"),
  ]);
  assert.equal(visibleTaskHierarchy(filtered, new Set(), new Map()).length, 1);
  const cycle = taskHierarchyIndex([
    row("a", "b"),
    row("b", "c"),
    row("c", "a"),
  ]);
  assert.equal(
    visibleTaskHierarchy(cycle, new Set(["a", "b", "c"]), new Map()).length,
    3,
  );
  assert.equal(taskDescendants(cycle, "a").size, 2);
});

test("대량 하위 태스크는 50개씩 펼치고 깊은 작업도 재귀 호출 없이 표시한다", () => {
  const index = taskHierarchyIndex([
    row("root"),
    ...Array.from({ length: 6001 }, (_, i) => row(`child-${i}`, "root")),
  ]);
  const first = visibleTaskHierarchy(index, new Set(["root"]), new Map());
  assert.equal(first.filter((r) => r.kind === "task").length, 51);
  assert.deepEqual(first.at(-1), {
    kind: "more",
    parentId: "root",
    depth: 1,
    shown: 50,
    total: 6001,
  });
  assert.equal(
    visibleTaskHierarchy(
      index,
      new Set(["root"]),
      new Map([["root", 100]]),
    ).filter((r) => r.kind === "task").length,
    101,
  );
  const roots = taskHierarchyIndex(
    Array.from({ length: 120 }, (_, i) => row(`root-${i}`)),
  );
  assert.equal(visibleTaskHierarchy(roots, new Set(), new Map()).length, 50);
  const chain = taskHierarchyIndex(
    Array.from({ length: 100 }, (_, i) =>
      row(`level-${i}`, i ? `level-${i - 1}` : null),
    ),
  );
  const result = visibleTaskHierarchy(
    chain,
    new Set(chain.byId.keys()),
    new Map(),
  );
  assert.equal(result.length, 100);
  assert.equal(result.at(-1)!.depth, 99);
});
