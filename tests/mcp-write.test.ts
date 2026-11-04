import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
test("MCP로 프로젝트·기능·태스크를 생성·수정하고 조회 권한은 쓰기를 막는다", async () => {
  const store = new Store();
  const service = new Service(store, {
    name: "planner",
    role: "write",
    repositories: ["org/repo"],
  });
  const server = createMcpServer(service),
    client = new Client({ name: "planner-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    const content = result.content as { type: string; text: string }[];
    return JSON.parse(content.find((c) => c.type === "text")!.text);
  };
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    for (const tool of [
      "create_project",
      "update_project",
      "create_feature",
      "update_feature",
      "create_task",
      "update_task",
      "bulk_update_entities",
    ])
      assert.ok(tools.includes(tool));
    const project = await call("create_project", {
      id: "mcp-p",
      name: "고객 인증",
      goal: "인증 경험 개선",
      repositories: ["org/repo"],
    });
    const feature = await call("create_feature", {
      id: "mcp-f",
      project: "mcp-p",
      name: "로그인",
      goal: "통합 로그인",
      acceptanceCriteria: "- [ ] 로그인 성공",
    });
    const task = await call("create_task", {
      id: "MCP-TASK",
      project: "mcp-p",
      feature: "mcp-f",
      title: "인증 API 구현",
    });
    const child = await call("create_task", {
      id: "MCP-CHILD",
      project: "mcp-p",
      feature: "mcp-f",
      title: "오류 수정",
      type: "bug",
      parentId: "MCP-TASK",
    });
    assert.equal(child.data.parentId, "MCP-TASK");
    const children = await call("list_tasks", {
      parentId: "MCP-TASK",
      type: "bug",
    });
    assert.deepEqual(
      children.map((t: { data: { id: string } }) => t.data.id),
      ["MCP-CHILD"],
    );
    assert.equal(feature.data.acceptanceCriteria, "- [ ] 로그인 성공");
    await call("update_project", {
      data: {
        ...project.data,
        name: "고객 인증 개편",
        startDate: "2026-11-01",
        endDate: "2026-11-30",
      },
      revision: project.revision,
    });
    await call("update_feature", {
      data: { ...feature.data, goal: "GitHub 조직 계정으로 로그인" },
      revision: feature.revision,
    });
    const updated = await call("update_task", {
      data: { ...task.data, assignee: "developer", status: "ready" },
      revision: task.revision,
    });
    await call("bulk_update_entities", {
      kind: "task",
      entries: [{ id: "MCP-TASK", revision: updated.revision }],
      patch: { priority: "high" },
    });
    const dashboard = await call("get_project_status", {});
    assert.equal(dashboard.projects[0].data.name, "고객 인증 개편");
    assert.equal(
      dashboard.features[0].data.goal,
      "GitHub 조직 계정으로 로그인",
    );
    assert.equal(
      dashboard.tasks.find(
        (t: { data: { id: string } }) => t.data.id === "MCP-TASK",
      ).data.priority,
      "high",
    );
    const stale = await client.callTool({
      name: "update_task",
      arguments: { data: task.data, revision: task.revision },
    });
    assert.equal(stale.isError, true);
    const completed = await client.callTool({
      name: "update_task",
      arguments: {
        data: {
          ...dashboard.tasks.find(
            (t: { data: { id: string } }) => t.data.id === "MCP-TASK",
          ).data,
          status: "done",
        },
        revision: dashboard.tasks.find(
          (t: { data: { id: string } }) => t.data.id === "MCP-TASK",
        ).revision,
      },
    });
    assert.notEqual(completed.isError, true);
    assert.equal(
      (await call("get_project_status", {})).tasks.find(
        (row: { data: { id: string } }) => row.data.id === "MCP-TASK",
      ).data.status,
      "done",
    );
    const denied = await client.callTool({
      name: "create_project",
      arguments: {
        id: "private",
        name: "비공개",
        goal: "",
        repositories: ["org/private"],
      },
    });
    assert.equal(denied.isError, true);
    const readerServer = createMcpServer(
        new Service(store, {
          name: "reader",
          role: "read",
          repositories: ["org/repo"],
        }),
      ),
      reader = new Client({ name: "reader-test", version: "1" });
    const [c, d] = InMemoryTransport.createLinkedPair();
    await readerServer.connect(c);
    await reader.connect(d);
    try {
      const names = (await reader.listTools()).tools.map((t) => t.name);
      assert.ok(!names.includes("create_project"));
      assert.ok(!names.includes("update_task"));
      const rejected = await reader.callTool({
        name: "create_task",
        arguments: {},
      });
      assert.equal(rejected.isError, true);
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
