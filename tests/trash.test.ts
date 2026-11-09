import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
test("삭제 묶음은 현재 권한과 버전을 검사하고 하위 작업·댓글을 원자적으로 복구한다", async () => {
  const store = new Store(),
    service = new Service(store, {
      name: "writer",
      role: "write",
      repositories: ["org/repo"],
    });
  try {
    await service.saveProject({
      id: "p",
      name: "프로젝트",
      goal: "",
      repositories: ["org/repo"],
    });
    await service.saveTask({ id: "parent", project: "p", title: "상위" });
    await service.saveTask({
      id: "child",
      project: "p",
      parentId: "parent",
      title: "하위",
    });
    await store.save(
      "comment",
      "comment-1",
      { id: "comment-1", task: "child", body: "보존할 댓글" },
      "writer",
    );
    const p = (await store.get("project", "p"))!;
    await service.removeEntities({
      kind: "project",
      entries: [{ id: "p", revision: p.revision }],
    });
    assert.equal((await service.dashboard()).tasks.length, 0);
    const trash = await service.listTrash();
    assert.equal(trash.items.length, 1);
    assert.ok(trash.items[0]!.count >= 5);
    const denied = new Service(store, {
      name: "other",
      role: "write",
      repositories: ["other/repo"],
    });
    assert.equal((await denied.listTrash()).items.length, 0);
    await assert.rejects(denied.restoreTrash({ id: trash.items[0]!.id }));
    const read = new Service(store, { name: "reader", role: "read" });
    await assert.rejects(read.restoreTrash({ id: trash.items[0]!.id }));
    await service.restoreTrash({ id: trash.items[0]!.id });
    assert.equal((await service.dashboard()).tasks.length, 2);
    assert.equal(
      (await store.get<{ body: string }>("comment", "comment-1"))?.data.body,
      "보존할 댓글",
    );
    assert.equal((await service.listTrash()).items.length, 0);
    await assert.rejects(service.restoreTrash({ id: trash.items[0]!.id }));
  } finally {
    await store.close();
  }
});
test("복구 검증 실패는 이미 복원한 항목까지 롤백한다", async () => {
  const store = new Store(),
    service = new Service(store, { name: "writer", role: "write" });
  try {
    await service.saveProject({
      id: "p",
      name: "프로젝트",
      goal: "",
      repositories: [],
    });
    const t = (await service.saveTask({
      id: "t",
      project: "p",
      title: "태스크",
    }))!;
    await service.removeEntities({
      kind: "task",
      entries: [{ id: "t", revision: t.revision }],
    });
    const batch = (await service.listTrash()).items[0]!;
    // A regular update cannot resurrect a tombstone, even with its current revision.
    await assert.rejects(
      store.save("task", "t", t.data, "writer", t.revision + 1),
    );
    const p = (await store.get("project", "p"))!;
    await service.removeEntities({
      kind: "project",
      entries: [{ id: "p", revision: p.revision }],
    });
    await assert.rejects(service.restoreTrash({ id: batch.id }));
    assert.equal(await store.get("task", "t"), undefined);
  } finally {
    await store.close();
  }
});

test("기존 삭제 이력은 현재 tombstone과 일치하는 묶음만 휴지통으로 이관한다", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path"),
    directory = await mkdtemp(join(tmpdir(), "cloud-pm-legacy-trash-")),
    path = join(directory, "db");
  let store = new Store(undefined, path);
  try {
    const s = new Service(store, { name: "writer", role: "write" });
    await s.saveProject({
      id: "legacy",
      name: "이관",
      goal: "",
      repositories: [],
    });
    const task = (await s.saveTask({
      id: "legacy-task",
      project: "legacy",
      title: "복구 대상",
    }))!;
    await s.removeEntities({
      kind: "task",
      entries: [{ id: "legacy-task", revision: task.revision }],
    });
    // Reproduce the old schema: tombstone + audit events, no deletion archive.
    await store.query("DELETE FROM record_deletions");
    await store.query(
      "DELETE FROM app_migrations WHERE id='trash-backfill-v1'",
    );
    await store.close();
    store = new Store(undefined, path);
    const upgraded = new Service(store, { name: "writer", role: "write" }),
      trash = await upgraded.listTrash();
    assert.equal(trash.items.length, 1);
    await upgraded.restoreTrash({ id: trash.items[0]!.id });
    assert.equal(
      (await store.get<{ title: string }>("task", "legacy-task"))?.data.title,
      "복구 대상",
    );
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
