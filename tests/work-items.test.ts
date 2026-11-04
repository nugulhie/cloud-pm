import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
import type { Task, GitHubItem } from "../src/core/model";

test("프로젝트만으로 작업 생성·수정·하위 작업·중복 가져오기를 지원한다", async () => {
  const store = new Store();
  const service = new Service(store, { name: "editor", role: "write" });
  try {
    await service.saveProject({
      id: "p",
      name: "프로젝트",
      goal: "",
      repositories: ["org/repo"],
    });
    const parent = await service.saveTask({
      id: "parent",
      project: "p",
      title: "기능 하나",
    });
    assert.ok(parent?.data.feature);
    const child = await service.saveTask({
      id: "child",
      project: "p",
      title: "하위 작업",
      parentId: "parent",
    });
    assert.equal(child?.data.feature, parent?.data.feature);
    const updated = await service.saveTask(
      { ...parent!.data, feature: undefined, title: "수정" },
      parent!.revision,
    );
    assert.equal(updated?.data.feature, parent?.data.feature);
    const done = await service.saveTask({
      id: "done",
      project: "p",
      title: "수동 완료",
      status: "done",
    });
    assert.equal(done?.data.status, "done");
    await assert.rejects(
      new Service(store, { name: "viewer", role: "read" }).saveTask({
        id: "bad",
        project: "p",
        title: "금지",
      }),
      /수정 권한/,
    );
    const item: GitHubItem = {
      id: "org/repo#1",
      repository: "org/repo",
      number: 1,
      kind: "issue",
      title: "이슈",
      body: "",
      author: "dev",
      assignees: [],
      reviewers: [],
      state: "open",
      url: "https://github.com/org/repo/issues/1",
      updatedAt: new Date().toISOString(),
    };
    await store.save("github", item.id, item, "sync");
    assert.deepEqual(
      await service.importItems({ project: "p", items: [item.id] }),
      { created: 1, skipped: 0 },
    );
    assert.deepEqual(
      await service.importItems({ project: "p", items: [item.id] }),
      { created: 0, skipped: 1 },
    );
    assert.equal((await store.list<Task>("task")).length, 4);
  } finally {
    await store.close();
  }
});

test("태스크 없는 기존 기능만 이관하고 삭제 후에도 다시 생성하지 않는다", async () => {
  const store = new Store();
  const service = new Service(store, { name: "editor", role: "write" });
  try {
    await service.saveProject({
      id: "p",
      name: "프로젝트",
      goal: "",
      repositories: ["org/repo"],
    });
    await service.saveFeature({
      id: "empty",
      project: "p",
      name: "기존 기능",
      goal: "설명",
      acceptanceCriteria: "확인 기준",
    });
    await service.saveFeature({
      id: "used",
      project: "p",
      name: "묶음",
      goal: "",
    });
    await service.saveTask({
      id: "old-task",
      project: "p",
      feature: "used",
      title: "기존 작업",
    });
    assert.deepEqual(await service.migrateWorkItems(), { created: 1 });
    assert.deepEqual(await service.migrateWorkItems(), { created: 0 });
    const migrated = (await store.list<Task>("task")).find(
      (row) => row.data.feature === "empty",
    )!;
    assert.match(migrated.data.description, /설명[\s\S]*확인 기준/);
    await service.removeEntities({
      kind: "task",
      entries: [{ id: migrated.data.id, revision: migrated.revision }],
    });
    assert.deepEqual(await service.migrateWorkItems(), { created: 0 });
    assert.ok(await store.get("task", "old-task"));
  } finally {
    await store.close();
  }
});
