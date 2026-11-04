import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
import type { GitHubItem } from "../src/core/model";

async function connect(service: Service) {
  const server = createMcpServer(service),
    client = new Client({ name: "work-tools-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  const raw = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await raw(name, args);
    assert.notEqual(response.isError, true, JSON.stringify(response));
    return JSON.parse((response.content as { text: string }[])[0]!.text);
  };
  return {
    client,
    raw,
    call,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

test("MCP 상세·부분 수정·일정·삭제 미리보기와 충돌/권한·직접 완료", async () => {
  const store = new Store();
  const service = new Service(store, {
    name: "planner",
    role: "write",
    repositories: ["org/repo"],
  });
  const { call, raw, close } = await connect(service);
  try {
    await call("create_project", {
      id: "p",
      name: "계획",
      goal: "목표",
      repositories: ["org/repo"],
    });
    const task = await call("create_task", {
      id: "t",
      project: "p",
      title: "초기 작업",
      assignee: "original",
      description: "보존할 설명",
      priority: "high",
      status: "in_progress",
      dueDate: "2026-11-10",
      yaml: "",
    });
    const updated = await call("update_task_fields", {
      id: "t",
      revision: task.revision,
      patch: { title: "수정 작업" },
    });
    assert.equal(updated.data.title, "수정 작업");
    for (const key of [
      "assignee",
      "description",
      "priority",
      "status",
      "dueDate",
      "yaml",
    ])
      assert.deepEqual(updated.data[key], task.data[key], key);
    assert.equal(
      (
        await raw("update_task_fields", {
          id: "t",
          revision: task.revision,
          patch: { title: "덮어쓰기" },
        })
      ).isError,
      true,
    );
    const completed = await call("update_task_fields", {
      id: "t",
      revision: updated.revision,
      patch: { status: "done" },
    });
    assert.equal(completed.data.status, "done");
    const reopened = await call("update_task_fields", {
      id: "t",
      revision: completed.revision,
      patch: { status: "in_progress" },
    });
    assert.equal(reopened.data.status, "in_progress");
    assert.equal(
      (
        await raw("update_task_fields", {
          id: "t",
          revision: reopened.revision,
          patch: {},
        })
      ).isError,
      true,
    );
    assert.equal(
      (
        await raw("update_task_fields", {
          id: "t",
          revision: reopened.revision,
          patch: { project: "other" },
        })
      ).isError,
      true,
    );
    assert.equal((await call("get_task", { id: "t" })).data.title, "수정 작업");
    assert.equal(
      (await call("get_project_schedule", { project: "p" })).tasks[0].dueDate,
      "2026-11-10",
    );
    await call("create_task", {
      id: "child",
      project: "p",
      title: "하위",
      parentId: "t",
    });
    const preview = await call("preview_delete_entities", {
      kind: "task",
      ids: ["t"],
    });
    assert.equal(preview.tasks, 2);
    assert.equal((await call("get_task", { id: "child" })).data.parentId, "t");
    assert.equal(
      (await call("list_projects", { query: "계획", limit: 1 })).total,
      1,
    );
    assert.ok(
      (await call("list_change_history", { targetId: "t" })).total >= 1,
    );
    const p = await call("get_project", { id: "p" });
    const changed = await call("update_project_fields", {
      id: "p",
      revision: p.revision,
      patch: { endDate: "2026-12-31" },
    });
    assert.equal(changed.data.goal, "목표");
    const requirement = await call("save_requirement", {
      data: {
        id: "r",
        project: "p",
        featureName: "기획",
        policy: "기존 정책",
        status: "approved",
      },
    });
    const nextRequirement = await call("update_requirement_fields", {
      id: "r",
      revision: requirement.revision,
      patch: { featureName: "기획 수정" },
    });
    assert.equal(nextRequirement.data.policy, "기존 정책");
    assert.equal(nextRequirement.data.status, "approved");
    assert.equal(
      (await call("get_requirement", { id: "r" })).data.featureName,
      "기획 수정",
    );
    const doc = await call("save_knowledge", {
      data: {
        id: "k",
        kind: "policy",
        name: "정책",
        content: "기존 내용",
        aliases: ["alias"],
        status: "active",
      },
    });
    const nextDoc = await call("update_knowledge_fields", {
      id: "k",
      revision: doc.revision,
      patch: { name: "새 정책" },
    });
    assert.equal(nextDoc.data.content, "기존 내용");
    assert.deepEqual(nextDoc.data.aliases, ["alias"]);
    assert.equal(nextDoc.data.status, "active");
    assert.equal(
      (await call("get_knowledge", { id: "k" })).data.name,
      "새 정책",
    );
    const reader = await connect(
      new Service(store, { name: "reader", role: "read", repositories: [] }),
    );
    try {
      assert.ok(
        !(await reader.client.listTools()).tools.some(
          (tool) => tool.name === "update_task_fields",
        ),
      );
      assert.equal((await reader.raw("get_task", { id: "t" })).isError, true);
      assert.equal(
        (
          await reader.raw("preview_delete_entities", {
            kind: "project",
            ids: ["p"],
          })
        ).isError,
        true,
      );
      assert.equal((await reader.call("list_projects")).total, 0);
      assert.equal(
        (
          await reader.raw("update_task_fields", {
            id: "t",
            revision: updated.revision,
            patch: { title: "권한 없음" },
          })
        ).isError,
        true,
      );
    } finally {
      await reader.close();
    }
    await assert.rejects(
      service.patchEntity({
        kind: "task",
        id: "t",
        revision: updated.revision,
        patch: { id: "hijack" },
      }),
    );
    await assert.rejects(
      new Service(store, { name: "reader", role: "read" }).patchEntity({
        kind: "task",
        id: "t",
        revision: updated.revision,
        patch: { title: "거부" },
      }),
    );
  } finally {
    await close();
    await store.close();
  }
});

test("MCP GitHub 검색은 종류·프로젝트·태그·담당자·리뷰와 페이지를 적용하며 원본을 수정하지 않는다", async () => {
  const store = new Store();
  const service = new Service(store, {
    name: "planner",
    role: "write",
    repositories: ["org/repo"],
  });
  const { call, raw, close } = await connect(service);
  try {
    await service.saveProject({
      id: "p",
      name: "p",
      goal: "",
      repositories: ["ORG/REPO"],
    });
    for (const [number, kind, state, repo] of [
      [1, "pr", "open", "org/repo"],
      [2, "issue", "open", "org/repo"],
      [3, "pr", "merged", "org/repo"],
      [4, "pr", "open", "org/private"],
    ] as const) {
      const item: GitHubItem = {
        id: `${repo}#${number}`,
        repository: repo,
        number,
        kind,
        state,
        title: `활동 ${number}`,
        body: "긴 본문",
        author: "dev",
        assignees: ["pm"],
        reviewers: ["reviewer"],
        reviewerTeams: ["team"],
        labels: [{ name: "bug", color: "ff0000" }],
        url: "https://example.invalid",
        updatedAt: `2026-10-29T00:00:0${number}Z`,
      };
      await store.save("github", item.id, item, "test");
    }
    const first = await call("list_github_activities", {
      project: "p",
      limit: 1,
    });
    assert.equal(first.total, 2);
    assert.equal(first.items[0].data.number, 2);
    assert.equal(first.nextOffset, 1);
    assert.equal(first.items[0].data.body, undefined);
    assert.equal(first.items[0].data.bodyPreview, "긴 본문");
    const filtered = await call("list_github_activities", {
      project: "p",
      kind: "pr",
      label: "BUG",
      assignee: "PM",
      reviewer: "team",
      author: "DEV",
      includeBody: true,
    });
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0].data.body, "긴 본문");
    assert.equal(
      (await call("list_github_activities", { state: "merged" })).total,
      1,
    );
    assert.equal(
      (await call("list_github_activities", { hideClosed: false })).total,
      3,
    );
    assert.equal(
      (await raw("list_github_activities", { project: "unknown" })).isError,
      true,
    );
    assert.equal(
      (await raw("get_github_activity", { id: "org/private#4" })).isError,
      true,
    );
    assert.equal(
      (await call("get_github_activity", { id: "org/repo#2" })).body,
      "긴 본문",
    );
    assert.equal((await call("list_task_links", { project: "p" })).total, 0);
    assert.equal((await store.list("github")).length, 4);
  } finally {
    await close();
    await store.close();
  }
});
