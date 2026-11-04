import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
import type { Task, Project } from "../src/core/model";
const csv = {
  fileName: "이전 프로젝트.csv",
  format: "csv" as const,
  content:
    "Task ID,Name,Projects,Parent Task\n2,하위,외부 프로젝트,상위\n1,상위,외부 프로젝트,",
};

test("기존 프로젝트·GitHub 연결 없이 Asana 프로젝트와 작업을 생성하고 형식 간 재가져오기를 식별한다", async () => {
  const store = new Store(),
    service = new Service(store, {
      name: "planner",
      role: "write",
      repositories: [],
    });
  try {
    const preview = await service.previewAsanaProject(csv);
    assert.equal((await store.list("project")).length, 0);
    assert.equal(preview.projectInfo.data.name, "외부 프로젝트");
    assert.deepEqual(preview.projectInfo.data.repositories, []);
    const result = await service.importAsanaProject({
      ...csv,
      projectName: preview.projectInfo.data.name,
      sourceProjectKey: preview.projectInfo.sourceKey,
      mode: "skip",
      previewHash: preview.previewHash,
      ids: ["1", "2"],
    });
    assert.equal(result.projectCreated, true);
    assert.equal(result.created, 2);
    const tasks = await store.list<Task>("task");
    assert.equal(
      tasks.find((row) => row.data.title === "하위")?.data.parentId,
      tasks.find((row) => row.data.title === "상위")?.data.id,
    );
    assert.equal((await service.dashboard()).projects.length, 1);
    const duplicate = await service.previewAsanaProject(csv);
    assert.equal(duplicate.projectInfo.existing?.id, result.project);
    const skipped = await service.importAsanaProject({
      ...csv,
      mode: "skip",
      previewHash: duplicate.previewHash,
      ids: ["1", "2"],
    });
    assert.equal(skipped.projectCreated, false);
    assert.equal(skipped.skipped, 2);
    assert.equal((await store.list("project")).length, 1);
    const json = {
      fileName: "이름 바뀐 파일.json",
      format: "json" as const,
      content: JSON.stringify({
        project: {
          gid: "900",
          name: "외부 프로젝트",
          notes: "프로젝트 목표",
          start_on: "2026-11-01",
          due_on: null,
        },
        data: [{ gid: "1", name: "상위 수정" }],
      }),
    };
    const next = await service.previewAsanaProject(json);
    assert.equal(next.projectInfo.existing?.id, result.project);
    await service.importAsanaProject({
      ...json,
      mode: "update",
      previewHash: next.previewHash,
      ids: ["1"],
    });
    const project = (await store.get<Project>("project", result.project))!;
    assert.equal(project.data.goal, "프로젝트 목표");
    assert.equal(project.data.startDate, "2026-11-01");
    assert.equal(project.data.endDate, null);
    assert.equal((await store.list("project")).length, 1);
    const renamed = {
      ...json,
      content: JSON.stringify({
        project: { gid: "900", name: "이름 변경한 원본" },
        tasks: [{ gid: "1", name: "상위 수정" }],
      }),
    };
    assert.equal(
      (await service.previewAsanaProject(renamed)).projectInfo.existing?.id,
      result.project,
    );
    const reader = new Service(store, {
      name: "reader",
      role: "read",
      repositories: [],
    });
    assert.equal((await reader.dashboard()).projects.length, 1);
    await assert.rejects(
      reader.importAsanaProject({
        ...csv,
        mode: "skip",
        previewHash: duplicate.previewHash,
        ids: [],
      }),
    );
    assert.equal(
      (
        await new Service(store.forWorkspace("other"), {
          name: "other",
          role: "write",
          workspaceId: "other",
          repositories: [],
        }).previewAsanaProject(csv)
      ).projectInfo.existing,
      null,
    );
    await assert.rejects(service.sync({ project: result.project }), /저장소/);
  } finally {
    await store.close();
  }
});

test("프로젝트+작업을 원자적으로 저장하고 오래된 미리보기·삭제된 프로젝트의 재생성을 거부한다", async () => {
  const store = new Store(),
    service = new Service(store, {
      name: "pm",
      role: "write",
      repositories: [],
    });
  try {
    const preview = await service.previewAsanaProject(csv);
    await assert.rejects(
      service.importAsanaProject({
        ...csv,
        mode: "skip",
        previewHash: preview.previewHash,
        ids: ["2"],
      }),
    );
    assert.equal((await store.list("project")).length, 0);
    assert.equal((await store.list("feature")).length, 0);
    assert.equal((await store.list("external-project")).length, 0);
    const result = await service.importAsanaProject({
      ...csv,
      mode: "skip",
      previewHash: preview.previewHash,
      ids: ["1", "2"],
    });
    const next = await service.previewAsanaProject(csv),
      project = (await store.get<Project>("project", result.project))!;
    await service.saveProject(
      { ...project.data, name: "다른 사람이 수정" },
      project.revision,
    );
    await assert.rejects(
      service.importAsanaProject({
        ...csv,
        mode: "update",
        previewHash: next.previewHash,
        ids: ["1", "2"],
      }),
      /변경/,
    );
    const current = (await store.get<Project>("project", result.project))!;
    await service.removeEntities({
      kind: "project",
      entries: [{ id: current.data.id, revision: current.revision }],
    });
    await assert.rejects(service.previewAsanaProject(csv));
    assert.equal((await store.list("project")).length, 0);
  } finally {
    await store.close();
  }
});

test("작업 없는 프로젝트도 가져오고 기존 저장소 기반 프로젝트의 접근 범위는 유지한다", async () => {
  const store = new Store(),
    admin = new Service(store, { name: "admin", role: "write" });
  try {
    const file = {
      fileName: "empty.json",
      format: "json" as const,
      content: JSON.stringify({
        project: {
          gid: "1000",
          name: "빈 프로젝트",
          start_on: null,
          due_on: null,
        },
        tasks: [],
      }),
    };
    const preview = await admin.previewAsanaProject(file);
    const result = await admin.importAsanaProject({
      ...file,
      mode: "skip",
      previewHash: preview.previewHash,
      ids: [],
    });
    assert.equal(result.projectCreated, true);
    assert.equal(result.created, 0);
    const project = (await store.get<Project>("project", result.project))!;
    await admin.saveProject(
      { ...project.data, repositories: ["org/private"] },
      project.revision,
    );
    const restricted = new Service(store, {
      name: "restricted",
      role: "write",
      repositories: [],
    });
    await assert.rejects(restricted.previewAsanaProject(file));
    assert.equal((await restricted.dashboard()).projects.length, 0);
    const current = (await store.get<Project>("project", result.project))!;
    await assert.rejects(
      admin.saveProject(
        { ...current.data, repositories: [] },
        current.revision,
      ),
      /마지막 연결/,
    );
    const other = {
      ...file,
      content: JSON.stringify({
        project: { gid: "2000", name: "빈 프로젝트" },
        tasks: [],
      }),
    };
    assert.equal(
      (await admin.previewAsanaProject(other)).projectInfo.existing,
      null,
    );
  } finally {
    await store.close();
  }
});

test("MCP 외부 프로젝트 가져오기는 대상 프로젝트 없이 생성하며 JSON 컨테이너를 읽는다", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } =
    await import("@modelcontextprotocol/sdk/inMemory.js");
  const { createMcpServer } = await import("../src/mcp/server");
  const store = new Store(),
    service = new Service(store, {
      name: "pm",
      role: "write",
      repositories: [],
    }),
    server = createMcpServer(service),
    client = new Client({ name: "project-import-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const file = {
      fileName: "project.json",
      format: "json",
      content: JSON.stringify({
        data: [
          {
            gid: "500",
            name: "JSON 프로젝트",
            resource_type: "project",
            tasks: [{ gid: "1", name: "JSON 작업" }],
          },
        ],
      }),
    };
    const previewResult = await client.callTool({
      name: "preview_asana_project",
      arguments: file,
    });
    assert.notEqual(previewResult.isError, true);
    const preview = JSON.parse(
      (previewResult.content as { text: string }[])[0]!.text,
    );
    assert.equal(preview.projectInfo.data.name, "JSON 프로젝트");
    assert.equal(preview.rows.length, 1);
    const result = await client.callTool({
      name: "import_asana_project",
      arguments: {
        ...file,
        previewHash: preview.previewHash,
        mode: "skip",
        ids: ["1"],
      },
    });
    assert.notEqual(result.isError, true);
    assert.equal((await service.dashboard()).projects.length, 1);
    assert.equal((await store.list<Task>("task"))[0]?.data.title, "JSON 작업");
  } finally {
    await client.close();
    await server.close();
    await store.close();
  }
});

test("파일 이름만 같고 작업이 다른 파일은 원본 키 확인 없이 기존 프로젝트에 합치지 않는다", async () => {
  const store = new Store(),
    service = new Service(store, {
      name: "pm",
      role: "write",
      repositories: [],
    });
  try {
    const first = {
      fileName: "export.csv",
      format: "csv" as const,
      content: "Task ID,Name\n1,처음 작업",
    };
    const preview = await service.previewAsanaProject(first);
    const result = await service.importAsanaProject({
      ...first,
      mode: "skip",
      previewHash: preview.previewHash,
      ids: ["1"],
    });
    const next = { ...first, content: "Task ID,Name\n2,다른 작업" };
    await assert.rejects(service.previewAsanaProject(next), /원본 키/);
    const confirmed = {
      ...next,
      sourceProjectKey: preview.projectInfo.sourceKey,
    };
    const explicit = await service.previewAsanaProject(confirmed);
    assert.equal(explicit.projectInfo.existing?.id, result.project);
    await service.importAsanaProject({
      ...confirmed,
      mode: "skip",
      previewHash: explicit.previewHash,
      ids: ["2"],
    });
    assert.equal((await store.list("project")).length, 1);
    assert.equal((await store.list("task")).length, 2);
  } finally {
    await store.close();
  }
});
