import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
import { GitHubClient } from "../src/github/client";
import { DomainError, type Task } from "../src/core/model";
import {
  requirementInput,
  requirementTaskIds,
  type Requirement,
  type IssuePublication,
} from "../src/core/requirement-model";

test("하나의 PRD를 저장소·담당자별 여러 태스크와 이슈로 관리한다", async (t) => {
  const store = new Store();
  const writes: {
    repository: string;
    body: { title: string; body: string; assignees?: string[] };
  }[] = [];
  let failRepo = "";
  const github = new GitHubClient({
    fetch: async (url, init) => {
      if (String(url).includes("/assignees/"))
        return new Response(null, { status: 204 });
      assert.equal(init?.method, "POST");
      const repository = new URL(String(url)).pathname
        .split("/")
        .slice(2, 4)
        .join("/");
      const body = JSON.parse(String(init?.body));
      writes.push({ repository, body });
      if (repository === failRepo)
        throw new TypeError("synthetic response lost");
      const number = writes.length;
      return Response.json(
        {
          number,
          title: body.title,
          body: body.body,
          html_url: `https://github.com/${repository}/issues/${number}`,
          user: { login: "bot" },
          updated_at: new Date().toISOString(),
          assignees: (body.assignees ?? []).map((login: string) => ({ login })),
        },
        { status: 201 },
      );
    },
  });
  const service = new Service(store, { name: "pm", role: "write" }, github);
  const requirement = () =>
    store.get<Requirement>("requirement", "signup").then((r) => r!);
  const request = async (taskId: string, repository: string) => ({
    id: "signup",
    revision: (await requirement()).revision,
    taskId,
    repository,
  });
  const conflict = (e: unknown) => e instanceof DomainError && e.status === 409;
  try {
    await service.saveProject({
      id: "product",
      name: "제품",
      goal: "",
      featurePrefix: "ADMIN",
      repositories: ["org/frontend", "org/backend"],
    });
    await service.saveProject({
      id: "other",
      name: "다른 제품",
      goal: "",
      repositories: [],
    });
    await service.saveKnowledge({
      id: "signup-policy",
      kind: "policy",
      name: "가입 정책",
      content: "검증",
      dependsOn: [],
    });
    await service.saveRequirement({
      id: "signup",
      project: "product",
      featureName: "회원가입",
      sourceId: "SIGNUP",
      description: "약관에 동의하고 가입한다",
      policyIds: ["signup-policy"],
    });
    await t.test(
      "각 태스크의 저장소·담당자와 전체 연결을 저장하고 재요청은 중복을 만들지 않는다",
      async () => {
        const result = await service.convertRequirements({
          entries: [{ id: "signup", revision: 1 }],
          tasks: [
            {
              id: "signup-fe",
              title: "회원가입 화면",
              repository: "ORG/Frontend",
              assignee: "frontend-dev",
            },
            {
              id: "signup-be",
              title: "회원가입 API",
              repository: "org/backend",
              assignee: "backend-dev",
              description: "POST /signup 구현",
            },
          ],
        });
        assert.deepEqual(result.results[0]!.createdTasks, [
          "signup-fe",
          "signup-be",
        ]);
        const row = await requirement();
        assert.deepEqual(requirementTaskIds(row.data), [
          "signup-fe",
          "signup-be",
        ]);
        assert.equal(row.data.taskId, "signup-fe");
        const tasks = (await service.dashboard()).tasks;
        assert.equal(
          tasks.find((t) => t.data.id === "signup-fe")!.data.repository,
          "org/frontend",
        );
        assert.equal(
          tasks.find((t) => t.data.id === "signup-be")!.data.assignee,
          "backend-dev",
        );
        const repeat = await service.convertRequirements({
          entries: [{ id: "signup", revision: row.revision }],
          tasks: [{ id: "signup-fe", title: "다른 제목" }],
        });
        assert.equal(repeat.results[0]!.created, false);
        assert.equal((await service.dashboard()).tasks.length, 2);
        assert.equal(
          (await store.get<Task>("task", "signup-fe"))!.data.title,
          "회원가입 화면",
        );
        await assert.rejects(
          service.convertRequirements({
            entries: [{ id: "signup", revision: 1 }],
            tasks: [{ id: "stale", title: "오래된 입력" }],
          }),
          conflict,
        );
      },
    );
    await t.test(
      "명시적 태스크 선택·저장소 일치·미리보기 충돌을 검사한다",
      async () => {
        await assert.rejects(
          service.previewRequirementIssue({
            id: "signup",
            revision: 2,
            repository: "org/frontend",
          }),
          /태스크를 선택/,
        );
        await assert.rejects(
          service.previewRequirementIssue(
            await request("signup-be", "org/frontend"),
          ),
          /지정된 저장소/,
        );
        await assert.rejects(
          service.previewRequirementIssue(
            await request("not-linked", "org/frontend"),
          ),
          /연결된 태스크/,
        );
        const body = await request("signup-be", "org/backend");
        const preview = await service.previewRequirementIssue(body);
        assert.equal(preview.title, "[ADMIN-001] 회원가입 API");
        assert.equal(preview.assignee, "backend-dev");
        assert.match(preview.body, /POST \/signup 구현/);
        assert.match(preview.body, /task: signup-be/);
        const task = (await store.get<Task>("task", "signup-be"))!;
        await service.saveTask(
          { ...task.data, description: "추가 검증" },
          task.revision,
        );
        await assert.rejects(
          service.publishRequirementIssue({
            ...body,
            previewHash: preview.previewHash,
          }),
          conflict,
        );
        assert.equal(writes.length, 0);
      },
    );
    await t.test(
      "서로 다른 저장소에 이슈를 발행하고 중복 차단·링크는 태스크별로 동작한다",
      async () => {
        const [fe, be] = await Promise.all([
          service.publishRequirementIssue(
            await request("signup-fe", "org/frontend"),
          ),
          service.publishRequirementIssue(
            await request("signup-be", "org/backend"),
          ),
        ]);
        assert.equal(fe.repository, "org/frontend");
        assert.equal(be.repository, "org/backend");
        assert.notEqual(fe.id, be.id);
        assert.equal(
          (await service.publishRequirementIssue(
            await request("signup-fe", "org/frontend"),
          ))!.number,
          fe.number,
        );
        assert.equal(writes.length, 2);
        assert.deepEqual(writes.map((w) => w.body.assignees?.[0]).sort(), [
          "backend-dev",
          "frontend-dev",
        ]);
        const dashboard = await service.dashboard();
        assert.equal(dashboard.requirementIssues.length, 2);
        for (const issue of [fe, be])
          assert.ok(
            dashboard.links.some(
              (l) =>
                l.data.task === issue.task &&
                l.data.item === `${issue.repository}#${issue.number}`,
            ),
          );
        assert.equal(
          (await store.get<IssuePublication>("requirement-issue", "signup"))!
            .data.task,
          "signup-fe",
        );
      },
    );
    await t.test(
      "PRD 수정·정책 영향 분석·기존 클라이언트 저장에서도 모든 연결을 보존한다",
      async () => {
        const row = await requirement();
        const editable = Object.fromEntries(
          Object.entries(row.data).filter(
            ([key]) => key in requirementInput.shape,
          ),
        );
        await service.saveRequirement(
          { ...editable, remarks: "추가 검토" },
          row.revision,
        );
        assert.deepEqual(requirementTaskIds((await requirement()).data), [
          "signup-fe",
          "signup-be",
        ]);
        const task = (await store.get<Task>("task", "signup-be"))!;
        const { repository: _repository, ...legacyData } = task.data;
        await service.saveTask(legacyData, task.revision);
        assert.equal(
          (await store.get<Task>("task", "signup-be"))!.data.repository,
          "org/backend",
        );
        const impact = await service.getKnowledgeImpact({
          id: "signup-policy",
          kind: "tasks",
        });
        assert.equal(impact.page.total, 2);
        assert.ok(
          impact.page.items.every((item) =>
            item.references.every((ref) => ref.via === "task"),
          ),
        );
        await assert.rejects(
          service.saveTask({ ...task.data, project: "other", feature: "" }),
          /PRDに|PRD에/,
        );
        await assert.rejects(
          service.saveTask({ ...task.data, repository: "org/frontend" }),
          /발행 이력/,
        );
        await assert.rejects(
          service.deleteRequirements([
            { id: "signup", revision: (await requirement()).revision },
          ]),
          /삭제할 수 없습니다/,
        );
      },
    );
    await t.test(
      "추가 작업은 원자적이며 다른 프로젝트·기존 태스크·읽기 역할·다른 워크스페이스를 차단한다",
      async () => {
        const row = await requirement();
        await assert.rejects(
          service.convertRequirements({
            entries: [{ id: "signup", revision: row.revision }],
            tasks: [
              { id: "should-rollback", title: "롤백" },
              { id: "bad-repo", title: "권한 없음", repository: "secret/repo" },
            ],
          }),
          /프로젝트에 연결/,
        );
        assert.equal(await store.get("task", "should-rollback"), undefined);
        const outsider = (await service.saveTask({
          id: "outside",
          project: "product",
          title: "별도 작업",
        }))!;
        await assert.rejects(
          service.convertRequirements({
            entries: [{ id: "signup", revision: row.revision }],
            tasks: [{ id: outsider.data.id, title: "탈취" }],
          }),
          conflict,
        );
        for (const actor of [
          { name: "viewer", role: "read" as const },
          {
            name: "hidden",
            role: "write" as const,
            repositories: ["org/frontend"],
          },
          { name: "other", role: "write" as const, workspaceId: "other" },
        ]) {
          await assert.rejects(
            new Service(store, actor).convertRequirements({
              entries: [{ id: "signup", revision: row.revision }],
              tasks: [{ id: "forbidden", title: "금지" }],
            }),
          );
        }
        assert.equal((await requirement()).revision, row.revision);
      },
    );
    await t.test(
      "한 태스크의 응답 유실은 다른 태스크의 이슈 생성을 막지 않는다",
      async () => {
        const row = await requirement();
        await service.convertRequirements({
          entries: [{ id: "signup", revision: row.revision }],
          tasks: [
            {
              id: "unknown-task",
              title: "응답 유실",
              repository: "org/backend",
            },
            {
              id: "healthy-task",
              title: "정상 작업",
              repository: "org/frontend",
            },
          ],
        });
        failRepo = "org/backend";
        await assert.rejects(
          service.publishRequirementIssue(
            await request("unknown-task", "org/backend"),
          ),
          /응답을 확인하지 못했습니다/,
        );
        failRepo = "";
        await service.publishRequirementIssue(
          await request("healthy-task", "org/frontend"),
        );
        const before = writes.length;
        await assert.rejects(
          service.publishRequirementIssue(
            await request("unknown-task", "org/backend"),
          ),
          conflict,
        );
        assert.equal(writes.length, before);
        const issue = (
          await store.list<IssuePublication>("requirement-issue")
        ).find((r) => r.data.task === "unknown-task")!;
        assert.equal(issue.data.state, "unknown");
      },
    );
    await t.test(
      "CSV 재가져오기는 여러 태스크·이슈 연결을 보존하며 동시 추가는 revision 충돌로 차단한다",
      async () => {
        const before = await requirement();
        const file = {
          project: "product",
          fileName: "PRD.csv",
          csv: "ID,기능명\nSIGNUP,가입 개선\n",
        };
        const preview = await service.previewRequirementCsv(file);
        await service.importRequirementCsv({
          ...file,
          mode: "update",
          previewHash: preview.previewHash,
        });
        const current = await requirement();
        assert.equal(current.data.featureName, "가입 개선");
        assert.deepEqual(current.data.taskIds, before.data.taskIds);
        const results = await Promise.allSettled(
          ["concurrent-a", "concurrent-b"].map((id) =>
            service.convertRequirements({
              entries: [{ id: "signup", revision: current.revision }],
              tasks: [{ id, title: id }],
            }),
          ),
        );
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(
          results.filter((r) => r.status === "rejected" && conflict(r.reason))
            .length,
          1,
        );
        assert.equal(requirementTaskIds((await requirement()).data).length, 5);
      },
    );
    await t.test(
      "taskIds가 없는 기존 PRD와 단일 발행 이력은 추가 후에도 재발행하지 않는다",
      async () => {
        await service.saveRequirement({
          id: "legacy",
          project: "product",
          featureName: "기존 기획",
        });
        await service.convertRequirements({
          entries: [{ id: "legacy", revision: 1 }],
        });
        let row = (await store.get<Requirement>("requirement", "legacy"))!;
        const { taskIds: _taskIds, ...legacy } = row.data;
        row = (await store.save(
          "requirement",
          "legacy",
          legacy,
          "migration",
          row.revision,
        ))!;
        const input = {
          id: "legacy",
          revision: row.revision,
          repository: "org/frontend",
        };
        const issue = await service.publishRequirementIssue(input);
        assert.equal(issue.id, "legacy");
        await service.convertRequirements({
          entries: [{ id: "legacy", revision: row.revision }],
          tasks: [
            {
              id: "legacy-second",
              title: "추가 구현",
              repository: "org/backend",
            },
          ],
        });
        const current = (await store.get<Requirement>(
          "requirement",
          "legacy",
        ))!;
        const count = writes.length;
        assert.equal(
          (
            await service.publishRequirementIssue({
              ...input,
              revision: current.revision,
              taskId: legacy.taskId!,
            })
          ).url,
          issue.url,
        );
        assert.equal(writes.length, count);
        await service.publishRequirementIssue({
          id: "legacy",
          revision: current.revision,
          taskId: "legacy-second",
          repository: "org/backend",
        });
        assert.equal(writes.length, count + 1);
      },
    );
    await t.test(
      "MCP도 여러 태스크 생성과 개별 태스크 이슈 미리보기를 지원한다",
      async () => {
        await service.saveRequirement({
          id: "mcp-prd",
          project: "product",
          featureName: "MCP 요구사항",
        });
        const server = createMcpServer(service),
          client = new Client({ name: "prd-multi-test", version: "1" });
        const [local, remote] = InMemoryTransport.createLinkedPair();
        await server.connect(remote);
        await client.connect(local);
        try {
          const converted = await client.callTool({
            name: "convert_requirements_to_tasks",
            arguments: {
              entries: [{ id: "mcp-prd", revision: 1 }],
              tasks: [
                { id: "mcp-fe", title: "화면", repository: "org/frontend" },
                { id: "mcp-be", title: "API", repository: "org/backend" },
              ],
            },
          });
          assert.notEqual(converted.isError, true);
          const preview = await client.callTool({
            name: "preview_requirement_issue",
            arguments: {
              id: "mcp-prd",
              revision: 2,
              taskId: "mcp-be",
              repository: "org/backend",
            },
          });
          assert.notEqual(preview.isError, true);
          const value = JSON.parse(
            (preview.content as { type: string; text: string }[])[0]!.text,
          );
          assert.equal(value.taskId, "mcp-be");
          assert.equal(value.repository, "org/backend");
          assert.match(value.title, /API/);
        } finally {
          await client.close();
          await server.close();
        }
      },
    );
  } finally {
    await store.close();
  }
});
