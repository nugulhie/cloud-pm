import test from "node:test";
import assert from "node:assert/strict";
import { parseAsanaFile } from "../src/core/asana-file";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
import { DomainError, type Task } from "../src/core/model";

test("Asana의 동명 사용자 지정 열과 기본/별도 담당자를 덮어쓰지 않고 보존한다", () => {
  const file = {
    project: "p",
    fileName: "custom.csv",
    format: "csv" as const,
    content: [
      "Task ID,Name,Assignee,담당자,Notes,우선순위,우선순위,프론트엔드,프론트엔드,배포담당자,배포담당자",
      "1,기능,기본 담당,별도 담당,설명,1순위,상,첫 프론트,,배포A,배포B",
      "2,동일 등급,,,,높음,상,,,,",
      "3,충돌 등급,,,,높음,낮음,,,,",
      "4,,,,,,,,,,",
    ].join("\n"),
  };
  const preview = parseAsanaFile(file);
  assert.ok(preview.rows.every((row) => !row.errors.length));
  const first = preview.rows[0]!;
  assert.equal(first.assignee, "기본 담당");
  for (const value of [
    "담당자 [4열]: 별도 담당",
    "우선순위 [6열]: 1순위",
    "우선순위 [7열]: 상",
    "프론트엔드 [8열]: 첫 프론트",
    "배포담당자 [10열]: 배포A",
    "배포담당자 [11열]: 배포B",
  ])
    assert.ok(first.description.includes(value), value);
  assert.equal(first.fields.includes("priority"), false);
  assert.ok(first.warnings.length);
  assert.equal(preview.rows[1]!.priority, "high");
  assert.ok(preview.rows[1]!.fields.includes("priority"));
  assert.equal(preview.rows[2]!.fields.includes("priority"), false);
  assert.match(preview.rows[3]!.title, /이름 없는 Asana 작업 \(4\)/);
  assert.equal(preview.rows[3]!.fields.includes("title"), false);
  assert.ok(preview.warnings.some((w) => w.includes("동명")));
  assert.throws(
    () =>
      parseAsanaFile({ ...file, content: "Task ID,Task ID,Name\n1,2,이름" }),
    /1열.*2열/,
  );
  assert.equal(
    parseAsanaFile({ ...file, content: "Task ID,ID,Name\n1,사용자 ID,이름" })
      .rows[0]!.sourceId,
    "1",
  );
});

test("상위가 모호할 때 기본은 오류이며 명시적 옵션은 미연결로 생성하고 기존 연결·제목·우선순위를 보존한다", async () => {
  const store = new Store();
  const service = new Service(store, {
    name: "planner",
    role: "write",
    repositories: [],
  });
  const file = {
    fileName: "parents.csv",
    format: "csv" as const,
    content:
      "Task ID,Name,Parent Task,Notes,Projects\n1,같은 부모,,설명,외부\n2,같은 부모,,설명,외부\n3,하위,같은 부모,설명,외부\n4,외부 하위,파일 밖 부모,설명,외부",
  };
  try {
    const strict = await service.previewAsanaProject(file);
    assert.equal(strict.counts.invalid, 2);
    await assert.rejects(
      service.importAsanaProject({
        ...file,
        previewHash: strict.previewHash,
        ids: ["3"],
        mode: "skip",
      }),
    );
    assert.equal((await store.list("project")).length, 0);
    const policy = { ...file, unresolvedParents: "keep_unlinked" as const };
    await assert.rejects(
      service.importAsanaProject({
        ...policy,
        previewHash: strict.previewHash,
        ids: ["1"],
        mode: "skip",
      }),
      (error) => error instanceof DomainError && error.status === 409,
    );
    const preview = await service.previewAsanaProject(policy);
    assert.equal(preview.counts.invalid, 0);
    assert.equal(preview.counts.unresolvedParents, 2);
    const created = await service.importAsanaProject({
      ...policy,
      previewHash: preview.previewHash,
      mode: "skip",
      ids: ["1", "2", "3", "4"],
    });
    assert.equal(created.created, 4);
    const tasks = await store.list<Task>("task");
    const child = tasks.find((row) => row.data.title === "하위")!;
    const parent = tasks.find((row) => row.data.title === "같은 부모")!;
    assert.equal(child.data.parentId, null);
    assert.match(child.data.description, /원본 상위 작업: 같은 부모/);
    const edited = await service.saveTask(
      {
        ...child.data,
        parentId: parent.data.id,
        title: "직접 정한 제목",
        priority: "high",
      },
      child.revision,
    );
    assert.ok(edited);
    const update = {
      ...policy,
      sourceProjectKey: preview.projectInfo.sourceKey,
      content:
        "Task ID,Name,Parent Task,Notes,우선순위,우선순위\n3,,같은 부모,새 설명,1순위,상",
    };
    const next = await service.previewAsanaProject(update);
    assert.equal(next.counts.invalid, 0);
    await service.importAsanaProject({
      ...update,
      previewHash: next.previewHash,
      ids: ["3"],
      mode: "update",
    });
    const after = (await store.get<Task>("task", child.data.id))!.data;
    assert.equal(after.title, "직접 정한 제목");
    assert.equal(after.priority, "high");
    assert.equal(after.parentId, parent.data.id);
    assert.ok(after.description.includes("1순위"));
    const origins = await store.list<{
      sourceId: string;
      parentRef: string;
      unresolvedParent: boolean;
    }>("asana-import");
    assert.equal(
      origins.find((row) => row.data.sourceId === "3")!.data.parentRef,
      "같은 부모",
    );
    const cycle = {
      ...update,
      content: "Task ID,Name,Parent Task\n5,순환A,6\n6,순환B,5",
    };
    const invalid = await service.previewAsanaProject(cycle);
    assert.equal(invalid.counts.invalid, 2);
    await assert.rejects(
      service.importAsanaProject({
        ...cycle,
        previewHash: invalid.previewHash,
        ids: ["5", "6"],
        mode: "skip",
      }),
    );
    assert.equal((await store.list("task")).length, 4);
  } finally {
    await store.close();
  }
});
