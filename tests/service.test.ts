import assert from "node:assert/strict";
import test from "node:test";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
import { DomainError, type Task } from "../src/core/model";
import { authenticate } from "../src/core/auth";
import { analyze } from "../src/ai/analysis";
import { createMcpServer } from "../src/mcp/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GitHubClient } from "../src/github/client";
import { stringify } from "yaml";

const task: Task = {
  id: "TASK-1",
  project: "platform",
  feature: "login",
  title: "소셜 로그인",
  description: "",
  assignee: "",
  status: "in_progress",
  priority: "high",
  dueDate: "2020-01-01",
  blockedReason: "환경 설정 대기",
  yaml: "",
};
const project = {
  id: "platform",
  name: "플랫폼",
  goal: "통합 경험",
  repositories: ["org/config"],
};
const feature = {
  id: "login",
  project: "platform",
  name: "로그인",
  goal: "통합 인증",
};

test("DB·공통 서비스·MCP 통합", async (t) => {
  const store = new Store();
  const service = new Service(store, { name: "editor", role: "write" });
  try {
    await service.saveProject({
      ...project,
      repositories: ["Org/Config", "org/config"],
    });
    assert.deepEqual(
      (await store.get<{ repositories: string[] }>("project", "platform"))?.data
        .repositories,
      ["org/config"],
    );
    await service.saveFeature(feature);
    await service.saveTask(task);
    await t.test("개입 필요 항목과 규칙 브리핑", async () => {
      const d = await service.dashboard();
      assert.equal(d.attention.length, 1);
      assert.equal(d.attention[0]?.reasons.length, 3);
      assert.equal(d.briefing.type, "rule-based");
    });
    await t.test("원자적 수정과 감사 이력, 충돌 검출", async () => {
      const current = (await store.get<Task>("task", "TASK-1"))!;
      await service.saveTask(
        { ...current.data, assignee: "developer" },
        current.revision,
      );
      await assert.rejects(
        service.saveTask(current.data, current.revision),
        (e) => e instanceof DomainError && e.status === 409,
      );
      assert.equal(
        (await store.get<Task>("task", "TASK-1"))?.data.assignee,
        "developer",
      );
      const events = await store.history();
      assert.equal(events.length, 4);
    });
    await t.test("조회 역할은 변경할 수 없다", async () => {
      const reader = new Service(store, { name: "reader", role: "read" });
      await assert.rejects(
        reader.saveTask(task),
        (e) => e instanceof DomainError && e.status === 403,
      );
    });
    await t.test(
      "잘못된 기능을 거부하고 PR 없이 수동 완료를 허용한다",
      async () => {
        await assert.rejects(
          service.saveTask({ ...task, id: "BAD", feature: "missing" }),
        );
        const completed = await service.saveTask({
          ...task,
          id: "DONE",
          status: "done",
        });
        assert.equal(completed?.data.status, "done");
      },
    );
    await t.test("YAML 초안 식별자 불일치를 거부한다", async () => {
      await assert.rejects(
        service.saveTask({
          ...task,
          id: "OTHER",
          yaml: stringify({
            version: 1,
            task: "TASK-1",
            project: "platform",
            feature: "login",
            completion: {
              all: [
                {
                  pull_request: {
                    repository: "org/config",
                    number: 1,
                    state: "merged",
                    target_branch: "main",
                  },
                },
              ],
            },
          }),
        }),
      );
    });
    await t.test("AI 출력은 제공된 근거만 참조한다", async () => {
      const provider = {
        json: async () => ({
          summary: "진행 중",
          facts: [{ text: "진행 중", sources: ["made-up"] }],
          interpretations: [],
          unknowns: [],
        }),
      };
      await assert.rejects(analyze(provider, [task], []));
      const valid = await analyze(
        {
          json: async () => ({
            summary: "진행 중",
            facts: [{ text: "진행 중", sources: ["TASK-1"] }],
            interpretations: [],
            unknowns: ["배포 미확인"],
          }),
        },
        [task],
        [],
      );
      assert.equal(valid.facts.length, 1);
    });
    await t.test(
      "MCP 실제 클라이언트가 조회하고 권한에 맞는 도구를 받는다",
      async () => {
        const server = createMcpServer(
          new Service(store, { name: "reader", role: "read" }),
        );
        const client = new Client({ name: "test", version: "1" });
        const [a, b] = InMemoryTransport.createLinkedPair();
        await server.connect(a);
        await client.connect(b);
        try {
          const tools = await client.listTools();
          assert.ok(tools.tools.some((t) => t.name === "list_tasks"));
          assert.ok(!tools.tools.some((t) => t.name === "update_task"));
          const result = await client.callTool({
            name: "list_tasks",
            arguments: { project: "platform" },
          });
          assert.ok(JSON.stringify(result).includes("TASK-1"));
        } finally {
          await client.close();
          await server.close();
        }
      },
    );
    await t.test(
      "YAML 머지 조건 평가가 실제 저장 상태를 완료로 바꾼다",
      async () => {
        process.env.GITHUB_ORG = "org";
        const previousDemo = process.env.DEMO_MODE;
        delete process.env.DEMO_MODE;
        const definition = {
          version: 1,
          task: "TASK-1",
          project: "platform",
          feature: "login",
          completion: {
            all: [
              {
                pull_request: {
                  repository: "org/config",
                  number: 1,
                  state: "merged",
                  target_branch: "main",
                },
              },
            ],
          },
        };
        const text = stringify(definition);
        const sha = "a".repeat(40);
        const fetcher: typeof fetch = async (input) => {
          const u = new URL(String(input));
          if (u.pathname === "/orgs/org/repos")
            return Response.json([{ full_name: "org/config" }]);
          if (u.pathname === "/repos/org/config/issues")
            return Response.json([]);
          if (u.pathname === "/repos/org/config")
            return Response.json({ default_branch: "main" });
          if (u.pathname.includes("/git/ref/"))
            return Response.json({ object: { type: "commit", sha } });
          if (u.pathname === "/repos/org/config/contents/.cloud-pm/tasks")
            return Response.json([
              {
                type: "file",
                name: "TASK-1.yaml",
                path: ".cloud-pm/tasks/TASK-1.yaml",
              },
            ]);
          if (u.pathname.endsWith(".yaml"))
            return Response.json({
              type: "file",
              encoding: "base64",
              size: Buffer.byteLength(text),
              content: Buffer.from(text).toString("base64"),
            });
          if (u.pathname.endsWith("/pulls/1"))
            return Response.json({
              state: "closed",
              merged_at: "2026-10-20T01:00:00Z",
              base: { ref: "main" },
            });
          throw new Error(`unexpected ${u}`);
        };
        try {
          const syncing = new Service(
            store,
            { name: "sync", role: "write" },
            new GitHubClient({ fetch: fetcher }),
          );
          await store.query(
            "INSERT INTO app_users(id,login,display_name,password_hash,github_cipher,github_last4) VALUES('sync-owner','sync-owner','동기화 소유자','test-hash','test-cipher','test')",
          );
          await store.query(
            "INSERT INTO workspace_settings(id,owner_id,name) VALUES('secondary','sync-owner','별도 워크스페이스')",
          );
          const secondary = store.forWorkspace("secondary");
          const secondaryService = new Service(secondary, {
            name: "editor",
            role: "write",
            workspaceId: "secondary",
          });
          await secondaryService.saveProject(project);
          await secondaryService.saveFeature(feature);
          await secondaryService.saveTask(task);
          const report = await syncing.sync();
          assert.equal(
            (await secondary.get<Task>("task", "TASK-1"))?.data.status,
            "done",
          );
          assert.equal((await secondary.list("evaluation")).length, 1);
          assert.deepEqual(report.errors, []);
          assert.equal(
            (await store.get<Task>("task", "TASK-1"))?.data.status,
            "done",
          );
          assert.equal((await store.list("evaluation")).length, 1);
          assert.equal(
            (await store.query("SELECT * FROM sync_leases")).length,
            0,
          );
          const completed = (await store.get<Task>("task", "TASK-1"))!;
          await service.saveTask(
            { ...completed.data, status: "in_progress" },
            completed.revision,
          );
          await syncing.sync();
          assert.equal(
            (await store.get<Task>("task", "TASK-1"))!.data.status,
            "done",
          );
          assert.equal(
            (await store.get<Task>("task", "DONE"))!.data.status,
            "done",
          );
        } finally {
          delete process.env.GITHUB_ORG;
          if (previousDemo !== undefined) process.env.DEMO_MODE = previousDemo;
        }
      },
    );
  } finally {
    await store.close();
  }
});

test("인증은 잘못된 토큰·외부 origin을 거부한다", () => {
  const before = {
    read: process.env.APP_READ_TOKEN,
    write: process.env.APP_WRITE_TOKEN,
    demo: process.env.DEMO_MODE,
  };
  delete process.env.DEMO_MODE;
  process.env.APP_READ_TOKEN = "read-secret";
  process.env.APP_WRITE_TOKEN = "write-secret";
  try {
    assert.throws(() =>
      authenticate(new Request("http://localhost/api/dashboard")),
    );
    assert.throws(() =>
      authenticate(
        new Request("http://localhost/api/dashboard", {
          headers: { Authorization: "Bearer 읽기토큰" },
        }),
      ),
    );
    assert.throws(() =>
      authenticate(
        new Request("http://localhost/api/dashboard", {
          headers: {
            Authorization: "Bearer write-secret",
            origin: "https://evil.example",
          },
        }),
      ),
    );
    assert.equal(
      authenticate(
        new Request("http://localhost/api/dashboard", {
          headers: { Authorization: "Bearer read-secret" },
        }),
      ).role,
      "read",
    );
  } finally {
    for (const [key, value] of Object.entries({
      APP_READ_TOKEN: before.read,
      APP_WRITE_TOKEN: before.write,
      DEMO_MODE: before.demo,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
