import assert from "node:assert/strict";
import test from "node:test";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
import type { Task, Feature } from "../src/core/model";

test("기능 인수 기준, 하위 작업 관계·순환·이동 검증과 연쇄 삭제", async () => {
  const store = new Store();
  const service = new Service(store, { name: "editor", role: "write" });
  try {
    await service.saveProject({
      id: "p",
      name: "제품",
      goal: "출시",
      repositories: ["org/repo"],
    });
    await service.saveFeature({
      id: "f",
      project: "p",
      name: "로그인",
      goal: "인증",
      acceptanceCriteria: "- [ ] 로그인 성공",
    });
    await service.saveFeature({
      id: "other",
      project: "p",
      name: "기타",
      goal: "",
    });
    assert.equal(
      (await store.get<Feature>("feature", "f"))?.data.acceptanceCriteria,
      "- [ ] 로그인 성공",
    );
    const base = { project: "p", feature: "f", title: "작업" };
    await service.saveTask({ ...base, id: "parent" });
    await service.saveTask({
      ...base,
      id: "child",
      type: "bug",
      parentId: "parent",
    });
    await service.saveTask({ ...base, id: "grandchild", parentId: "child" });
    const parent = (await store.get<Task>("task", "parent"))!;
    const child = (await store.get<Task>("task", "child"))!;
    await assert.rejects(
      service.saveTask(
        { ...parent.data, parentId: "grandchild" },
        parent.revision,
      ),
      /循環|순환/,
    );
    await assert.rejects(
      service.saveTask({ ...child.data, parentId: "child" }, child.revision),
      /순환/,
    );
    await assert.rejects(
      service.saveTask({ ...base, id: "bad", parentId: "missing" }),
      /같은 프로젝트/,
    );
    await assert.rejects(
      service.saveTask({
        ...base,
        id: "bad",
        feature: "other",
        parentId: "parent",
      }),
      /같은 프로젝트/,
    );
    await assert.rejects(
      service.saveTask({ ...parent.data, feature: "other" }, parent.revision),
      /하위 태스크/,
    );
    const completed = await service.saveTask(
      { ...child.data, status: "done" },
      child.revision,
    );
    assert.equal(completed?.data.status, "done");
    assert.equal(
      (await store.get<Task>("task", "grandchild"))!.data.status,
      "backlog",
    );
    const { type: _type, parentId: _parent, ...legacy } = child.data;
    await service.saveTask({ ...legacy, title: "수정" }, completed!.revision);
    assert.equal((await store.get<Task>("task", "child"))?.data.type, "bug");
    assert.equal(
      (await store.get<Task>("task", "child"))?.data.parentId,
      "parent",
    );
    await service.removeEntities({
      kind: "task",
      entries: [{ id: "parent", revision: parent.revision }],
    });
    assert.equal((await store.list("task")).length, 0);
  } finally {
    await store.close();
  }
});
