import assert from "node:assert/strict";
import test from "node:test";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
import { DomainError, type Project } from "../src/core/model";
import { requirementLabel } from "../src/core/requirement-model";

test("프로젝트 5자리 식별자의 직접 지정·자동 생성·중복 방지·이름 수정·기존 프로젝트 보완", async () => {
  const store = new Store(),
    service = new Service(store, { name: "pm", role: "write" });
  try {
    const first = (await service.saveProject({
      id: "one",
      name: "Admin",
      goal: "",
      repositories: [],
      featurePrefix: "admin",
    }))!;
    assert.equal(first.data.featurePrefix, "ADMIN");
    const next = (await service.saveProject({
      id: "two",
      name: "Admin",
      goal: "",
      repositories: [],
    }))!;
    assert.match(next.data.featurePrefix!, /^[A-Z0-9]{5}$/);
    assert.notEqual(next.data.featurePrefix, "ADMIN");
    await assert.rejects(
      service.saveProject({
        id: "three",
        name: "Other",
        goal: "",
        repositories: [],
        featurePrefix: "ADMIN",
      }),
      (e) => e instanceof DomainError && e.status === 409,
    );
    for (const prefix of ["ABCD", "ABCDEF", "가나다라마", "A-B_C"])
      await assert.rejects(
        service.saveProject({
          id: "invalid",
          name: "Invalid",
          goal: "",
          repositories: [],
          featurePrefix: prefix,
        }),
      );
    const renamed = (await service.saveProject(
      { ...first.data, name: "Renamed", featurePrefix: undefined },
      first.revision,
    ))!;
    assert.equal(renamed.data.featurePrefix, "ADMIN");
    await store.save(
      "project",
      "legacy",
      { id: "legacy", name: "기존 프로젝트", goal: "", repositories: [] },
      "seed",
    );
    const before = (await store.get<Project>("project", "legacy"))!;
    const rows = (await service.dashboard()).projects;
    const legacy = rows.find((row) => row.data.id === "legacy")!;
    assert.match(legacy.data.featurePrefix!, /^[A-Z0-9]{5}$/);
    assert.equal(legacy.revision, before.revision + 1);
    await service.dashboard();
    assert.equal(
      (await store.get<Project>("project", "legacy"))!.revision,
      legacy.revision,
    );
    const other = new Service(store, {
      name: "other",
      role: "write",
      workspaceId: "other",
    });
    assert.equal(
      (await other.saveProject({
        id: "one",
        name: "Other space",
        goal: "",
        repositories: [],
        featurePrefix: "ADMIN",
      }))!.data.featurePrefix,
      "ADMIN",
    );
  } finally {
    await store.close();
  }
});

test("PRD 접두어 변경은 순번·CSV 원본 ID·내부 연결을 유지하며 다음 태스크·이슈 제목에 적용된다", async () => {
  const store = new Store(),
    service = new Service(store, { name: "pm", role: "write" });
  try {
    const project = (await service.saveProject({
      id: "product",
      name: "제품",
      goal: "",
      repositories: ["org/repo"],
      featurePrefix: "PRODT",
    }))!;
    const row = (await service.saveRequirement({
      id: "r1",
      project: "product",
      featureName: "초대",
      sourceId: "TCO-1",
    }))!;
    assert.equal(
      requirementLabel(row.data, project.data.featurePrefix),
      "PRODT-001",
    );
    await service.convertRequirements({
      entries: [{ id: "r1", revision: row.revision }],
    });
    const task = (await service.dashboard()).tasks[0]!;
    assert.equal(task.data.title, "[PRODT-001] 초대");
    assert.match(task.data.description, /원본 ID: TCO-1/);
    const current = (await service.dashboard()).requirements[0]!;
    await service.saveProject(
      { ...project.data, featurePrefix: "NEWPR" },
      project.revision,
    );
    const preview = await service.previewRequirementIssue({
      id: "r1",
      revision: current.revision,
      repository: "org/repo",
    });
    assert.equal(preview.title, "[NEWPR-001] 초대");
    const unchanged = (await service.dashboard()).requirements[0]!;
    assert.equal(unchanged.data.number, 1);
    assert.equal(unchanged.data.sourceId, "TCO-1");
    assert.equal(unchanged.data.taskId, task.data.id);
  } finally {
    await store.close();
  }
});
