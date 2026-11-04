import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
import type { GitHubItem } from "../src/core/model";
test("일정·GitHub 선택 가져오기·일괄 수정·삭제와 감사 기록", async () => {
  const store = new Store(),
    service = new Service(store, { name: "editor", role: "write" });
  try {
    await assert.rejects(
      service.saveProject({
        id: "bad",
        name: "잘못된 일정",
        goal: "",
        repositories: ["org/repo"],
        startDate: "2026-10-31",
        endDate: "2026-10-01",
      }),
    );
    await service.saveProject({
      id: "p",
      name: "프로젝트",
      goal: "",
      repositories: ["org/repo"],
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
    await service.saveFeature({
      id: "f",
      project: "p",
      name: "기능",
      goal: "",
    });
    const item: GitHubItem = {
      id: "org/repo#1",
      repository: "org/repo",
      number: 1,
      kind: "pr",
      title: "머지 PR",
      body: "# 본문\n" + "상세 내용 ".repeat(120),
      author: "author",
      assignees: [],
      reviewers: [],
      state: "merged",
      url: "https://github.com/org/repo/pull/1",
      updatedAt: new Date().toISOString(),
    };
    await store.save("github", item.id, item, "sync");
    assert.deepEqual(
      await service.importItems({
        project: "p",
        feature: "f",
        items: [item.id, item.id],
      }),
      { created: 1, skipped: 0 },
    );
    assert.deepEqual(
      await service.importItems({
        project: "p",
        feature: "f",
        items: [item.id],
      }),
      { created: 0, skipped: 1 },
    );
    const task = (await service.dashboard()).tasks[0]!;
    assert.equal(task.data.status, "backlog");
    const history = await service.history();
    assert.equal(
      history
        .find((e) => e.kind === "github")
        ?.changes.find((c) => c.field === "본문")?.after,
      item.body,
    );
    await service.bulkUpdate({
      kind: "task",
      entries: [{ id: task.data.id, revision: task.revision }],
      patch: { assignee: "developer" },
    });
    await assert.rejects(
      service.bulkUpdate({
        kind: "task",
        entries: [{ id: task.data.id, revision: task.revision }],
        patch: { assignee: "other" },
      }),
    );
    const completed = await service.bulkUpdate({
      kind: "task",
      entries: [{ id: task.data.id, revision: 2 }],
      patch: { status: "done" },
    });
    assert.equal(completed.results[0]!.ok, true);
    assert.equal((await service.dashboard()).tasks[0]!.data.status, "done");
    const reader = new Service(store, { name: "reader", role: "read" });
    await assert.rejects(
      reader.removeEntities({
        kind: "project",
        entries: [{ id: "p", revision: 1 }],
      }),
    );
    const denied = new Service(store, {
      name: "other",
      role: "write",
      repositories: ["org/private"],
    });
    await assert.rejects(
      denied.importItems({ project: "p", feature: "f", items: [item.id] }),
    );
    await assert.rejects(
      denied.removeEntities({
        kind: "project",
        entries: [{ id: "p", revision: 1 }],
      }),
    );
    await assert.rejects(
      service.removeEntities({
        kind: "project",
        entries: [{ id: "p", revision: 2 }],
      }),
    );
    assert.equal((await service.dashboard()).tasks.length, 1);
    await service.removeEntities({
      kind: "project",
      entries: [{ id: "p", revision: 1 }],
    });
    const after = await service.dashboard();
    assert.equal(after.projects.length, 0);
    assert.equal(after.features.length, 0);
    assert.equal(after.tasks.length, 0);
    assert.equal(after.links.length, 0);
    assert.equal(after.items.length, 1);
    assert.ok(
      (await service.history()).some(
        (e) => e.kind === "project" && e.action === "deleted",
      ),
    );
  } finally {
    await store.close();
  }
});
test("일괄 삭제의 revision 불일치 시 전체 항목 유지", async () => {
  const store = new Store();
  try {
    await store.save("project", "a", { id: "a" }, "editor");
    await store.save("project", "b", { id: "b" }, "editor");
    await assert.rejects(
      store.removeMany(
        [
          { kind: "project", id: "a", revision: 1 },
          { kind: "project", id: "b", revision: 2 },
        ],
        "editor",
      ),
    );
    assert.ok(await store.get("project", "a"));
    assert.ok(await store.get("project", "b"));
  } finally {
    await store.close();
  }
});
