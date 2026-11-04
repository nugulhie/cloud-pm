import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
import { taskSchema, type Task } from "../src/core/model";
import {
  isDependencyBlocked,
  pendingDependencies,
} from "../src/core/dependencies";
import { createMcpServer } from "../src/mcp/server";
function setup() {
  const url = process.env.DEPENDENCY_TEST_DATABASE_URL;
  if (url && !new URL(url).pathname.startsWith("/cloud_pm_dependency_check_"))
    throw new Error("의존성 검증은 전용 임시 DB에서만 실행합니다.");
  const store = new Store(url).forWorkspace(`deps-${randomUUID()}`);
  const actor = {
    name: "editor",
    role: "write" as const,
    workspaceId: store.workspaceId,
    repositories: ["org/repo"],
  };
  const service = new Service(store, actor);
  return { store, service, actor };
}
async function seed(service: Service) {
  await service.saveProject({
    id: "p",
    name: "제품",
    goal: "",
    repositories: ["org/repo"],
  });
  for (const id of ["f", "other"])
    await service.saveFeature({ id, project: "p", name: id, goal: "" });
  for (const id of ["a", "b", "c"])
    await service.saveTask({
      id,
      project: "p",
      feature: "f",
      title: id,
      assignee: "editor",
    });
}

test("선행 작업 등록·호환성·차단 표시·완료 해제·권한·순환 검증", async () => {
  const { store, service, actor } = setup();
  try {
    await seed(service);
    const b = (await store.get<Task>("task", "b"))!;
    await service.saveTask(
      { ...b.data, feature: "other", dependsOn: ["a", "a"] },
      b.revision,
    );
    let current = (await store.get<Task>("task", "b"))!;
    assert.deepEqual(current.data.dependsOn, ["a"]);
    assert.equal((await service.taskDependencies("b")).blocked, true);
    assert.equal((await service.taskDependencies("a")).successors[0]?.id, "b");
    assert.ok(
      (await service.dashboard()).attention
        .find((row) => row.task === "b")
        ?.reasons.some((r) => r.includes("선행 작업 미완료")),
    );
    const { dependsOn: _dependency, ...legacy } = current.data;
    await service.saveTask(
      { ...legacy, title: "기존 클라이언트 수정", status: "in_progress" },
      current.revision,
    );
    current = (await store.get<Task>("task", "b"))!;
    assert.deepEqual(current.data.dependsOn, ["a"]);
    const f = (await store.get("feature", "f"))!;
    await assert.rejects(
      service.removeEntities({
        kind: "feature",
        entries: [{ id: "f", revision: f.revision }],
      }),
      /선행 작업으로 참조/,
    );
    const a = (await store.get<Task>("task", "a"))!;
    await assert.rejects(
      service.saveTask({ ...a.data, dependsOn: ["b"] }, a.revision),
      /순환/,
    );
    await assert.rejects(
      service.saveTask({ ...a.data, dependsOn: ["a"] }, a.revision),
      /자기 자신/,
    );
    await assert.rejects(
      service.saveTask({ ...a.data, dependsOn: ["missing"] }, a.revision),
      /같은 프로젝트/,
    );
    await service.saveProject({
      id: "p2",
      name: "다른 제품",
      goal: "",
      repositories: ["org/repo"],
    });
    await service.saveFeature({
      id: "f2",
      project: "p2",
      name: "다른 기능",
      goal: "",
    });
    await service.saveTask({
      id: "foreign",
      project: "p2",
      feature: "f2",
      title: "다른 작업",
    });
    await assert.rejects(
      service.saveTask({ ...a.data, dependsOn: ["foreign"] }, a.revision),
      /같은 프로젝트/,
    );
    await assert.rejects(
      service.saveTask({ ...a.data, project: "p2", feature: "f2" }, a.revision),
      /후행 작업/,
    );
    const limited = new Service(store, { ...actor, repositories: [] });
    await assert.rejects(limited.taskDependencies("b"), /접근 권한/);
    await assert.rejects(
      new Service(store, { ...actor, role: "read" }).saveTask(
        { ...a.data, dependsOn: [] },
        a.revision,
      ),
      /수정 권한/,
    );
    const otherWorkspace = new Service(store, {
      ...actor,
      workspaceId: "another-workspace",
    });
    await assert.rejects(otherWorkspace.taskDependencies("a"), /접근 권한/);
    // 취소는 선행 작업의 완료가 아니며, 실제 완료 기록이 갱신되면 파생 차단이 해제된다.
    const canceled = { ...a.data, status: "canceled" as const };
    assert.equal(pendingDependencies(current.data, [canceled]).length, 1);
    await store.save(
      "task",
      "a",
      { ...a.data, status: "done" },
      "completion-evaluator",
      a.revision,
    );
    assert.equal((await service.taskDependencies("b")).blocked, false);
    assert.equal(
      (await service.dashboard()).attention.some((row) => row.task === "b"),
      false,
    );
    assert.equal(
      isDependencyBlocked({ ...current.data, status: "done" }, [a.data]),
      false,
    );
    assert.equal(
      isDependencyBlocked({ ...current.data, status: "canceled" }, [a.data]),
      false,
    );
    await service.saveTask(
      { ...current.data, dependsOn: [] },
      current.revision,
    );
    assert.deepEqual((await store.get<Task>("task", "b"))!.data.dependsOn, []);
  } finally {
    await store.close();
  }
});

test("동시 관계 수정의 순환 방지와 삭제·트랜잭션 롤백", async () => {
  const { store, service } = setup();
  try {
    await seed(service);
    const a = (await store.get<Task>("task", "a"))!,
      b = (await store.get<Task>("task", "b"))!;
    const changes = await Promise.allSettled([
      service.saveTask({ ...a.data, dependsOn: ["b"] }, a.revision),
      service.saveTask({ ...b.data, dependsOn: ["a"] }, b.revision),
    ]);
    assert.equal(changes.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(changes.filter((r) => r.status === "rejected").length, 1);
    const records = await store.list<Task>("task");
    const dependent = records.find((r) => r.data.dependsOn?.length)!;
    const prerequisite = records.find(
      (r) => r.data.id === dependent.data.dependsOn![0],
    )!;
    await assert.rejects(
      service.removeEntities({
        kind: "task",
        entries: [
          { id: prerequisite.data.id, revision: prerequisite.revision },
        ],
      }),
      /선행 작업으로 참조/,
    );
    assert.ok(await store.get("task", prerequisite.data.id));
    await service.saveTask({
      id: "child",
      project: "p",
      feature: "f",
      title: "하위 작업",
      parentId: prerequisite.data.id,
    });
    const child = (await store.get<Task>("task", "child"))!;
    await assert.rejects(
      store.transaction(async (tx) => {
        await tx.save(
          "task",
          "rolled-back",
          { ...child.data, id: "rolled-back" },
          "test",
        );
        throw new Error("rollback");
      }),
      /rollback/,
    );
    assert.equal(await store.get("task", "rolled-back"), undefined);
    const events = await store.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM events WHERE entity_id='rolled-back' AND workspace_id=$1",
      [store.workspaceId],
    );
    assert.equal(events[0]?.count, 0);
    await service.removeEntities({
      kind: "task",
      entries: [
        { id: prerequisite.data.id, revision: prerequisite.revision },
        { id: dependent.data.id, revision: dependent.revision },
      ],
    });
    assert.equal(await store.get("task", "child"), undefined);
    assert.equal((await store.list("task")).length, 1);
  } finally {
    await store.close();
  }
});

test("MCP 선행 관계 수정·차단 필터·조회와 프로젝트 연쇄 삭제", async () => {
  const { store, service } = setup();
  const server = createMcpServer(service),
    client = new Client({ name: "dependency-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    await seed(service);
    const task = (await store.get<Task>("task", "c"))!;
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      return JSON.parse((result.content as { text: string }[])[0]!.text);
    };
    await call("update_task", {
      data: { ...task.data, dependsOn: ["a", "b"] },
      revision: task.revision,
    });
    const dependencies = await call("get_task_dependencies", { task: "c" });
    assert.equal(dependencies.blocked, true);
    assert.equal(dependencies.predecessors.length, 2);
    assert.deepEqual(
      (await call("list_tasks", { blocked: true, dependsOn: "a" })).map(
        (r: { data: Task }) => r.data.id,
      ),
      ["c"],
    );
    assert.deepEqual(
      (await call("list_tasks", { blocked: false })).map(
        (r: { data: Task }) => r.data.id,
      ),
      ["a", "b"],
    );
    await assert.rejects(
      service.removeEntities({
        kind: "feature",
        entries: [{ id: "f", revision: 99 }],
      }),
      /변경/,
    );
    const project = (await store.get("project", "p"))!;
    await service.removeEntities({
      kind: "project",
      entries: [{ id: "p", revision: project.revision }],
    });
    assert.equal((await store.list("task")).length, 0);
    assert.equal(
      taskSchema.safeParse({ ...task.data, dependsOn: Array(101).fill("a") })
        .success,
      false,
    );
  } finally {
    await client.close();
    await server.close();
    await store.close();
  }
});
