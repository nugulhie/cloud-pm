import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
import type { Task } from "../src/core/model";

test("6,001개·3 MiB 초과 Asana 프로젝트를 생성하고 하위 관계·중복·부분 갱신을 보존한다", async () => {
  const store = new Store();
  const service = new Service(store, {
    name: "planner",
    role: "write",
    repositories: [],
  });
  const count = 6001;
  const notes = "상세 정책 ".repeat(45);
  const csv = {
    fileName: "대규모 프로젝트.csv",
    format: "csv" as const,
    content:
      "Task ID,Name,Project ID,Project Name,Parent Task,Notes\n" +
      Array.from(
        { length: count },
        (_, i) =>
          `${10000 + i},작업 ${i},large-asana,대규모 Asana,${i % 2 ? 10000 + i - 1 : ""},${notes}`,
      )
        .reverse()
        .join("\n"),
  };
  try {
    assert.ok(Buffer.byteLength(csv.content) > 3 * 1024 * 1024);
    const preview = await service.previewAsanaProject(csv);
    assert.equal(preview.counts.total, count);
    assert.equal(preview.counts.invalid, 0);
    assert.equal((await store.list("project")).length, 0);
    const started = performance.now();
    const result = await service.importAsanaProject({
      ...csv,
      previewHash: preview.previewHash,
      mode: "skip",
      ids: preview.rows.map((row) => row.sourceId),
    });
    assert.equal(result.projectCreated, true);
    assert.equal(result.created, count);
    const tasks = await store.list<Task>("task");
    assert.equal(tasks.length, count);
    const byTitle = new Map(tasks.map((row) => [row.data.title, row.data]));
    for (const i of [1, 2999, 5999])
      assert.equal(
        byTitle.get(`작업 ${i}`)?.parentId,
        byTitle.get(`작업 ${i - 1}`)?.id,
      );
    const duplicate = await service.previewAsanaProject(csv);
    const repeated = await service.importAsanaProject({
      ...csv,
      previewHash: duplicate.previewHash,
      mode: "skip",
      ids: duplicate.rows.map((row) => row.sourceId),
    });
    assert.equal(repeated.projectCreated, false);
    assert.equal(repeated.skipped, count);
    const json = {
      fileName: "large.json",
      format: "json" as const,
      content: JSON.stringify({
        project: { gid: "large-asana", name: "대규모 갱신" },
        tasks: [
          { gid: "10001", name: "갱신한 첫 하위" },
          { gid: "15999", name: "갱신한 마지막 하위" },
        ],
      }),
    };
    const next = await service.previewAsanaProject(json);
    assert.equal(next.projectInfo.existing?.id, result.project);
    const updated = await service.importAsanaProject({
      ...json,
      previewHash: next.previewHash,
      mode: "update",
      ids: ["10001", "15999"],
    });
    assert.equal(updated.updated, 2);
    const after = await store.list<Task>("task");
    assert.equal(after.length, count);
    assert.equal(
      after.find((row) => row.data.title === "갱신한 마지막 하위")?.data
        .parentId,
      byTitle.get("작업 5998")?.id,
    );
    assert.equal((await service.dashboard()).tasks.length, count);
    assert.equal((await store.list("asana-import")).length, count);
    assert.equal((await store.list("project")).length, 1);
    console.log(
      `6,001개 생성·재가져오기·갱신·현황 검증: ${Math.round(performance.now() - started)}ms`,
    );
  } finally {
    await store.close();
  }
});
