import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
import { parseAsanaFile } from "../src/core/asana-file";
import type { Task } from "../src/core/model";
import {
  ASANA_MAX_FILE_BYTES,
  ASANA_MAX_TASKS,
} from "../src/core/asana-limits";
const csv = {
  project: "p",
  fileName: "asana.csv",
  format: "csv" as const,
  content:
    'Task ID,Name,Notes,Assignee,Due Date,Parent Task,Completed At,Section/Column\n2,하위 작업,"두 줄\n설명",pm,2026-11-20,상위 작업,2026-10-20,개발\n1,상위 작업,목표,owner,2026-11-30,,,',
};

test("Asana CSV/JSON에서 ID·설명·날짜·완료와 중첩 하위 작업을 정규화한다", () => {
  const parsed = parseAsanaFile(csv);
  assert.equal(parsed.rows[0]?.description.includes("두 줄\n설명"), true);
  assert.equal(parsed.rows[0]?.completed, true);
  assert.equal(parsed.rows[0]?.parentRef, "상위 작업");
  assert.equal(parsed.rows[0]?.dueDate, "2026-11-20");
  const json = parseAsanaFile({
    ...csv,
    format: "json",
    content: JSON.stringify({
      data: [
        {
          gid: "1209999999999999",
          name: "상위",
          assignee: { name: "PM" },
          subtasks: [
            { gid: "1209999999999998", name: "하위", completed: true },
          ],
        },
      ],
    }),
  });
  assert.equal(json.rows[0]?.sourceId, "1209999999999999");
  assert.equal(json.rows[1]?.parentRef, "1209999999999999");
  assert.equal(json.rows[1]?.completed, true);
  const priority = parseAsanaFile({
    ...csv,
    format: "json",
    content: JSON.stringify([
      {
        gid: "3",
        name: "우선순위",
        custom_fields: [{ name: "Priority", enum_value: { name: "High" } }],
      },
    ]),
  });
  assert.equal(priority.rows[0]?.priority, "high");
  assert.ok(priority.rows[0]?.fields.includes("priority"));
  assert.ok(
    parseAsanaFile({
      ...csv,
      format: "json",
      content: JSON.stringify([
        { id: Number.MAX_SAFE_INTEGER + 1, name: "unsafe" },
      ]),
    }).rows[0]?.errors.length,
  );
  assert.throws(() =>
    parseAsanaFile({ ...csv, format: "json", content: "{}" }),
  );
  assert.throws(() =>
    parseAsanaFile({ ...csv, content: "a".repeat(ASANA_MAX_FILE_BYTES + 1) }),
  );
});

test("Asana CSV와 JSON은 10,000개까지 누락 없이 읽고 초과분과 10 MiB 초과 파일을 명시적으로 거부한다", () => {
  const items = Array.from({ length: ASANA_MAX_TASKS }, (_, i) => ({
    gid: String(i + 1),
    name: `작업 ${i + 1}`,
  }));
  const json = {
    ...csv,
    format: "json" as const,
    content: JSON.stringify(items),
  };
  assert.equal(parseAsanaFile(json).rows.length, ASANA_MAX_TASKS);
  const content =
    "Task ID,Name\n" +
    items.map((item) => `${item.gid},${item.name}`).join("\n");
  assert.equal(
    parseAsanaFile({ ...csv, content }).rows.length,
    ASANA_MAX_TASKS,
  );
  assert.throws(
    () => parseAsanaFile({ ...csv, content: content + "\n10001,초과" }),
    /10,000/,
  );
  assert.throws(
    () =>
      parseAsanaFile({
        ...json,
        content: JSON.stringify([...items, { gid: "10001", name: "초과" }]),
      }),
    /10,000/,
  );
});

test("Asana 작업을 순서와 무관하게 원자적으로 가져오고 형식 간 중복·선택·부분 갱신을 처리한다", async () => {
  const store = new Store();
  const service = new Service(store, {
    name: "pm",
    role: "write",
    repositories: ["org/repo"],
  });
  try {
    await service.saveProject({
      id: "p",
      name: "p",
      goal: "",
      repositories: ["org/repo"],
    });
    const preview = await service.previewAsanaFile(csv);
    assert.equal((await store.list("task")).length, 0);
    await assert.rejects(
      service.importAsanaFile({
        ...csv,
        mode: "skip",
        previewHash: preview.previewHash,
        ids: ["2"],
      }),
    );
    assert.equal((await store.list("task")).length, 0);
    assert.deepEqual(
      await service.importAsanaFile({
        ...csv,
        mode: "skip",
        previewHash: preview.previewHash,
        ids: ["2", "1"],
      }),
      { created: 2, updated: 0, skipped: 0 },
    );
    const tasks = await store.list<Task>("task"),
      parent = tasks.find((row) => row.data.title === "상위 작업")!,
      child = tasks.find((row) => row.data.title === "하위 작업")!;
    assert.equal(child.data.parentId, parent.data.id);
    assert.equal(child.data.status, "backlog");
    assert.match(child.data.description, /원본 상태: 완료/);
    const duplicate = await service.previewAsanaFile(csv);
    assert.deepEqual(
      await service.importAsanaFile({
        ...csv,
        mode: "skip",
        previewHash: duplicate.previewHash,
        ids: ["1", "2"],
      }),
      { created: 0, updated: 0, skipped: 2 },
    );
    await service.saveTask(
      { ...parent.data, status: "in_progress", priority: "high", yaml: "" },
      parent.revision,
    );
    const file = {
      ...csv,
      fileName: "asana.json",
      format: "json" as const,
      content: JSON.stringify({ data: [{ gid: "1", name: "이름만 변경" }] }),
    };
    const update = await service.previewAsanaFile(file);
    assert.deepEqual(
      await service.importAsanaFile({
        ...file,
        mode: "update",
        previewHash: update.previewHash,
        ids: ["1"],
      }),
      { created: 0, updated: 1, skipped: 0 },
    );
    const latest = (await store.get<Task>("task", parent.data.id))!;
    assert.equal(latest.data.title, "이름만 변경");
    assert.equal(latest.data.assignee, "owner");
    assert.equal(latest.data.dueDate, "2026-11-30");
    assert.equal(latest.data.priority, "high");
    assert.equal(latest.data.status, "in_progress");
    assert.equal(latest.data.description, parent.data.description);
    await assert.rejects(
      service.importAsanaFile({
        ...file,
        mode: "update",
        previewHash: update.previewHash,
        ids: ["1"],
      }),
      /변경/,
    );
    await assert.rejects(
      new Service(store, { name: "reader", role: "read" }).previewAsanaFile(
        file,
      ),
    );
    await assert.rejects(
      new Service(store, {
        name: "denied",
        role: "write",
        repositories: [],
      }).importAsanaFile({
        ...file,
        mode: "skip",
        previewHash: update.previewHash,
        ids: ["1"],
      }),
    );
    await assert.rejects(
      new Service(store.forWorkspace("isolated"), {
        name: "other",
        role: "write",
        workspaceId: "isolated",
      }).previewAsanaFile(file),
    );
  } finally {
    await store.close();
  }
});

test("Asana 순환·중복·삭제된 원본의 재생성을 방지하고 중간 실패는 전체 롤백한다", async () => {
  const store = new Store(),
    service = new Service(store, { name: "pm", role: "write" });
  try {
    await service.saveProject({
      id: "p",
      name: "p",
      goal: "",
      repositories: ["org/repo"],
    });
    const cycle = {
      ...csv,
      format: "json" as const,
      content: JSON.stringify([
        { gid: "1", name: "a", parent: { gid: "2" } },
        { gid: "2", name: "b", parent: { gid: "1" } },
      ]),
    };
    assert.equal((await service.previewAsanaFile(cycle)).counts.invalid, 2);
    const duplicate = { ...csv, content: "Task ID,Name\n1,a\n1,b" };
    assert.equal((await service.previewAsanaFile(duplicate)).counts.invalid, 2);
    const seed = { ...csv, content: "Task ID,Name\n2,기존" };
    const seedPreview = await service.previewAsanaFile(seed);
    await service.importAsanaFile({
      ...seed,
      mode: "skip",
      previewHash: seedPreview.previewHash,
      ids: ["2"],
    });
    const child = (await store.list<Task>("task"))[0]!;
    await service.saveFeature({
      id: "legacy",
      project: "p",
      name: "legacy",
      goal: "",
    });
    await service.saveTask(
      { ...child.data, feature: "legacy" },
      child.revision,
    );
    const file = {
      ...csv,
      format: "json" as const,
      content: JSON.stringify([
        { gid: "1", name: "새 상위" },
        { gid: "2", name: "기존 하위", parent: { gid: "1" } },
      ]),
    };
    const preview = await service.previewAsanaFile(file);
    await assert.rejects(
      service.importAsanaFile({
        ...file,
        mode: "update",
        previewHash: preview.previewHash,
        ids: ["1", "2"],
      }),
    );
    assert.equal((await store.list("task")).length, 1);
    const current = (await store.get<Task>("task", child.data.id))!;
    await service.removeEntities({
      kind: "task",
      entries: [{ id: current.data.id, revision: current.revision }],
    });
    assert.equal((await service.previewAsanaFile(seed)).counts.invalid, 1);
    assert.equal((await store.list("task")).length, 0);
  } finally {
    await store.close();
  }
});

test("MCP도 Asana JSON 미리보기와 선택 가져오기를 제공하며 조회 연결은 쓰기를 노출하지 않는다", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } =
    await import("@modelcontextprotocol/sdk/inMemory.js");
  const { createMcpServer } = await import("../src/mcp/server");
  const store = new Store(),
    service = new Service(store, { name: "pm", role: "write" });
  const server = createMcpServer(service),
    client = new Client({ name: "asana-file-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    await service.saveProject({
      id: "p",
      name: "p",
      goal: "",
      repositories: ["org/repo"],
    });
    const file = {
      project: "p",
      fileName: "tasks.json",
      format: "json",
      content: JSON.stringify({ data: [{ gid: "1", name: "MCP 가져오기" }] }),
    };
    const previewResult = await client.callTool({
      name: "preview_asana_file",
      arguments: file,
    });
    assert.notEqual(previewResult.isError, true);
    const preview = JSON.parse(
      (previewResult.content as { text: string }[])[0]!.text,
    );
    const imported = await client.callTool({
      name: "import_asana_file",
      arguments: {
        ...file,
        mode: "skip",
        ids: ["1"],
        previewHash: preview.previewHash,
      },
    });
    assert.notEqual(imported.isError, true);
    assert.equal(
      (await store.list<Task>("task"))[0]?.data.title,
      "MCP 가져오기",
    );
    const readerServer = createMcpServer(
        new Service(store, { name: "reader", role: "read" }),
      ),
      reader = new Client({ name: "reader", version: "1" });
    const [c, d] = InMemoryTransport.createLinkedPair();
    await readerServer.connect(c);
    await reader.connect(d);
    try {
      assert.ok(
        !(await reader.listTools()).tools.some(
          (tool) => tool.name === "import_asana_file",
        ),
      );
    } finally {
      await reader.close();
      await readerServer.close();
    }
  } finally {
    await client.close();
    await server.close();
    await store.close();
  }
});
