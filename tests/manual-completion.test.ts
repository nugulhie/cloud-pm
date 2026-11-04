import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
import { DomainError, type Task } from "../src/core/model";

test("GitHub 없는 PM도 상하위 작업을 각각 완료·재개방하고 일괄 완료·변경 이력·권한·충돌을 유지한다", async () => {
  const store = new Store();
  const pm = new Service(store, {
    name: "PM",
    role: "write",
    repositories: [],
  });
  try {
    await pm.saveProject({
      id: "p",
      name: "기획 프로젝트",
      goal: "",
      repositories: [],
    });
    const parent = await pm.saveTask({
      id: "parent",
      project: "p",
      title: "출시 준비",
      status: "in_progress",
    });
    const child = await pm.saveTask({
      id: "child",
      project: "p",
      title: "정책 확인",
      parentId: "parent",
      status: "in_progress",
    });
    await pm.saveTask({
      id: "grandchild",
      project: "p",
      title: "문구 검토",
      parentId: "child",
    });
    const finished = await pm.patchEntity({
      kind: "task",
      id: "child",
      revision: child!.revision,
      patch: { status: "done" },
    });
    assert.ok(finished && "status" in finished.data);
    assert.equal(finished.data.status, "done");
    assert.equal(
      (await store.get<Task>("task", "parent"))!.data.status,
      "in_progress",
    );
    assert.equal(
      (await store.get<Task>("task", "grandchild"))!.data.status,
      "backlog",
    );
    await assert.rejects(
      pm.patchEntity({
        kind: "task",
        id: "child",
        revision: child!.revision,
        patch: { status: "ready" },
      }),
      (e) => e instanceof DomainError && e.status === 409,
    );
    const reopened = await pm.patchEntity({
      kind: "task",
      id: "child",
      revision: finished!.revision,
      patch: { status: "ready" },
    });
    assert.ok(reopened && "status" in reopened.data);
    assert.equal(reopened.data.status, "ready");
    const bulk = await pm.bulkUpdate({
      kind: "task",
      entries: [
        { id: "parent", revision: parent!.revision },
        { id: "child", revision: reopened!.revision },
      ],
      patch: { status: "done" },
    });
    assert.ok(bulk.results.every((result) => result.ok));
    const snapshot = await pm.dashboard();
    assert.equal(
      snapshot.tasks.filter((t) => t.data.status === "done").length,
      2,
    );
    const history = await pm.history();
    assert.ok(
      history.some(
        (event) =>
          event.actor === "PM" &&
          event.changes.some(
            (change) => change.field === "상태" && change.after === "완료",
          ),
      ),
    );
    assert.ok(
      history.some(
        (event) =>
          event.targetId === "child" &&
          event.changes.some(
            (change) =>
              change.before === "완료" && change.after === "준비 완료",
          ),
      ),
    );
    const current = (await store.get<Task>("task", "parent"))!;
    const reader = new Service(store, {
      name: "reader",
      role: "read",
      repositories: [],
    });
    await assert.rejects(
      reader.saveTask({ ...current.data, status: "ready" }, current.revision),
      (e) => e instanceof DomainError && e.status === 403,
    );
    const other = new Service(store.forWorkspace("other"), {
      name: "other",
      role: "write",
      workspaceId: "other",
      repositories: [],
    });
    await assert.rejects(
      other.saveTask({ ...current.data, status: "done" }, current.revision),
    );
    await assert.rejects(
      pm.bulkUpdate({
        kind: "task",
        entries: [{ id: "parent", revision: current.revision }],
        patch: { status: "unknown" },
      }),
    );
    assert.equal(
      (await store.get<Task>("task", "parent"))!.revision,
      current.revision,
    );
  } finally {
    await store.close();
  }
});
