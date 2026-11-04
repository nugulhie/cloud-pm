import assert from "node:assert/strict";
import test from "node:test";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
import { GitHubClient } from "../src/github/client";
import { DomainError } from "../src/core/model";
import type {
  Requirement,
  IssuePublication,
} from "../src/core/requirement-model";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server";

test("PRD 작성·태스크 전환·권한·충돌과 GitHub 발행", async (t) => {
  const store = new Store();
  let calls = 0,
    responseStatus = 201,
    failNetwork = false;
  const github = new GitHubClient({
    fetch: async (input, init) => {
      if (String(input).includes("/assignees/"))
        return new Response(null, { status: 204 });
      calls++;
      assert.equal(
        String(input),
        "https://api.github.com/repos/org/app/issues",
      );
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body));
      assert.match(body.body, /### 정책/);
      assert.match(body.body, /task: prd-task-/);
      if (failNetwork) throw new TypeError("network failure");
      return Response.json(
        {
          number: 77,
          html_url: "https://github.com/org/app/issues/77",
          title: body.title,
          body: body.body,
          user: { login: "editor" },
          updated_at: new Date().toISOString(),
          assignees: (body.assignees ?? []).map((login: string) => ({ login })),
        },
        { status: responseStatus },
      );
    },
  });
  const service = new Service(store, { name: "pm", role: "write" }, github);
  const input = {
    id: "requirement-1",
    project: "product",
    featureName: "초대 기능",
    description: "초대 링크로 참여한다.",
    policy: "초대는 7일간 유효하다.",
    remarks: "보안 검토",
    assignee: "developer",
    status: "approved",
  };
  const forbidden = (e: unknown) =>
    e instanceof DomainError && e.status === 403;
  const conflict = (e: unknown) => e instanceof DomainError && e.status === 409;
  try {
    await service.saveProject({
      id: "product",
      name: "제품",
      goal: "",
      repositories: ["org/app"],
    });
    await service.saveProject({
      id: "private",
      name: "비공개",
      goal: "",
      repositories: ["org/private"],
    });
    await service.saveFeature({
      id: "existing",
      project: "product",
      name: "기존 기능",
      goal: "",
    });
    await t.test(
      "프로젝트별 자동 번호, 서버 편집자, 수정 충돌 및 번호 재사용 방지",
      async () => {
        const first = (await service.saveRequirement(input))!;
        assert.equal(first.data.number, 1);
        assert.equal(first.data.editor, "pm");
        await assert.rejects(
          service.saveRequirement({ ...input, editor: "spoof" }),
        );
        const edited = (await service.saveRequirement(
          { ...input, policy: "변경된 정책" },
          first.revision,
        ))!;
        assert.equal(edited.data.number, 1);
        await assert.rejects(
          service.saveRequirement(input, first.revision),
          conflict,
        );
        const second = (await service.saveRequirement({
          ...input,
          id: "requirement-2",
        }))!;
        assert.equal(second.data.number, 2);
        await service.deleteRequirements([
          { id: second.data.id, revision: second.revision },
        ]);
        const third = (await service.saveRequirement({
          ...input,
          id: "requirement-3",
        }))!;
        assert.equal(third.data.number, 3);
        const other = (await service.saveRequirement({
          ...input,
          id: "private-1",
          project: "private",
        }))!;
        assert.equal(other.data.number, 1);
      },
    );
    await t.test("조회 역할·저장소 접근·워크스페이스 격리", async () => {
      const viewer = new Service(store, { name: "viewer", role: "read" });
      await assert.rejects(
        viewer.saveRequirement({ ...input, id: "bad" }),
        forbidden,
      );
      await assert.rejects(
        viewer.convertRequirements({
          entries: [{ id: input.id, revision: 2 }],
        }),
        forbidden,
      );
      await assert.rejects(
        viewer.deleteRequirements([{ id: input.id, revision: 2 }]),
        forbidden,
      );
      await assert.rejects(
        viewer.publishRequirementIssue({
          id: input.id,
          revision: 2,
          repository: "org/app",
        }),
        forbidden,
      );
      const scoped = new Service(store, {
        name: "scoped",
        role: "write",
        repositories: ["org/app"],
      });
      assert.equal(
        (await scoped.dashboard()).requirements.some(
          (r) => r.data.project === "private",
        ),
        false,
      );
      await assert.rejects(
        scoped.saveRequirement({
          ...input,
          id: "forbidden",
          project: "private",
        }),
        forbidden,
      );
      const other = new Service(store, {
        name: "other",
        role: "write",
        workspaceId: "other",
      });
      assert.equal((await other.dashboard()).requirements.length, 0);
      await assert.rejects(
        other.convertRequirements({ entries: [{ id: input.id, revision: 2 }] }),
      );
    });
    await t.test(
      "여러 항목 전환은 원자적이며 기능·태스크·정책을 연결하고 중복을 막는다",
      async () => {
        await assert.rejects(
          service.convertRequirements({
            entries: [
              { id: input.id, revision: 2 },
              { id: "private-1", revision: 1 },
            ],
            feature: "existing",
          }),
        );
        assert.equal((await service.dashboard()).tasks.length, 0);
        assert.equal(
          (await store.get<Requirement>("requirement", input.id))?.data.taskId,
          null,
        );
        const result = await service.convertRequirements({
          entries: [
            { id: input.id, revision: 2 },
            { id: "requirement-3", revision: 1 },
          ],
        });
        assert.equal(result.results.length, 2);
        const d = await service.dashboard();
        const task = d.tasks.find((r) => r.data.id === `prd-task-${input.id}`)!;
        assert.match(task.data.description, /변경된 정책/);
        assert.equal(task.data.assignee, "developer");
        assert.equal(task.data.status, "backlog");
        assert.equal(task.data.yaml, "");
        assert.equal(
          d.features.find((f) => f.data.id === task.data.feature)?.data.name,
          input.featureName,
        );
        const current = (await store.get<Requirement>(
          "requirement",
          input.id,
        ))!;
        const duplicate = await service.convertRequirements({
          entries: [{ id: input.id, revision: current.revision }],
        });
        assert.equal(duplicate.results[0]?.created, false);
        assert.equal((await service.dashboard()).tasks.length, 2);
        await assert.rejects(
          service.deleteRequirements([
            { id: input.id, revision: current.revision },
          ]),
        );
        await service.saveRequirement(
          { ...input, description: "PRD 수정" },
          current.revision,
        );
        assert.equal(
          (await service.dashboard()).tasks.find(
            (r) => r.data.id === task.data.id,
          )?.data.description,
          task.data.description,
        );
      },
    );
    await t.test(
      "이슈 미리보기는 외부 호출 없이 생성되며 저장소·revision을 검증한다",
      async () => {
        const row = (await store.get<Requirement>("requirement", input.id))!;
        const preview = await service.previewRequirementIssue({
          id: input.id,
          revision: row.revision,
          repository: "org/app",
        });
        assert.match(preview.body, /workspace: main/);
        assert.equal(calls, 0);
        await assert.rejects(
          service.previewRequirementIssue({
            id: input.id,
            revision: row.revision,
            repository: "org/private",
          }),
          forbidden,
        );
        await assert.rejects(
          service.publishRequirementIssue({
            id: input.id,
            revision: 1,
            repository: "org/app",
          }),
          conflict,
        );
        assert.equal(calls, 0);
        await assert.rejects(
          new Service(store, {
            name: "no-token",
            role: "write",
          }).publishRequirementIssue({
            id: input.id,
            revision: row.revision,
            repository: "org/app",
          }),
          forbidden,
        );
      },
    );
    await t.test(
      "실제 발행 경로는 한 번만 호출하고 이슈·태스크 연결을 기록한다",
      async () => {
        const row = (await store.get<Requirement>("requirement", input.id))!;
        const publication = await service.publishRequirementIssue({
          id: input.id,
          revision: row.revision,
          repository: "org/app",
        });
        assert.equal(publication.number, 77);
        assert.equal(calls, 1);
        await service.publishRequirementIssue({
          id: input.id,
          revision: row.revision,
          repository: "org/app",
        });
        assert.equal(calls, 1);
        const d = await service.dashboard();
        assert.equal(d.items.length, 1);
        assert.equal(d.links[0]?.data.status, "approved");
        assert.equal(d.links[0]?.data.task, row.data.taskId);
        assert.equal(d.links[0]?.data.item, "org/app#77");
        assert.ok(
          d.tasks.some((task) => task.data.id === d.links[0]?.data.task),
        );
        assert.equal(d.requirementIssues[0]?.data.state, "created");
        const limited = new Service(store, {
          name: "limited",
          role: "read",
          repositories: ["org/private"],
        });
        assert.equal((await limited.dashboard()).requirementIssues.length, 0);
      },
    );
    await t.test(
      "확실한 권한 실패만 재시도하고 응답 불명확 시 중복 발행을 차단한다",
      async () => {
        const row = (await store.get<Requirement>(
          "requirement",
          "requirement-3",
        ))!;
        responseStatus = 403;
        await assert.rejects(
          service.publishRequirementIssue({
            id: row.data.id,
            revision: row.revision,
            repository: "org/app",
          }),
        );
        assert.equal(
          (await store.get<IssuePublication>("requirement-issue", row.data.id))
            ?.data.state,
          "failed",
        );
        failNetwork = true;
        await assert.rejects(
          service.publishRequirementIssue({
            id: row.data.id,
            revision: row.revision,
            repository: "org/app",
          }),
        );
        assert.equal(
          (await store.get<IssuePublication>("requirement-issue", row.data.id))
            ?.data.state,
          "unknown",
        );
        const before = calls;
        await assert.rejects(
          service.publishRequirementIssue({
            id: row.data.id,
            revision: row.revision,
            repository: "org/app",
          }),
          conflict,
        );
        assert.equal(calls, before);
      },
    );
    await t.test(
      "MCP에서 PRD 조회·작성·전환을 사용할 수 있고 읽기 토큰에는 쓰기를 노출하지 않는다",
      async () => {
        for (const role of ["read", "write"] as const) {
          const server = createMcpServer(
            new Service(store, { name: "mcp", role }),
          );
          const client = new Client({ name: "prd-test", version: "1" });
          const [a, b] = InMemoryTransport.createLinkedPair();
          try {
            await server.connect(a);
            await client.connect(b);
            const { tools } = await client.listTools();
            assert.ok(tools.some((t) => t.name === "list_requirements"));
            assert.equal(
              tools.some((t) => t.name === "save_requirement"),
              role === "write",
            );
            if (role === "write") {
              const response = await client.callTool({
                name: "save_requirement",
                arguments: { data: { ...input, id: "mcp-prd" } },
              });
              assert.equal(response.isError, undefined);
              assert.ok(await store.get("requirement", "mcp-prd"));
            }
          } finally {
            await client.close();
            await server.close();
          }
        }
      },
    );
    await t.test(
      "프로젝트 삭제 시 PRD도 함께 제거하고 GitHub 원본 캐시는 유지한다",
      async () => {
        const row = (await service.dashboard()).projects.find(
          (p) => p.data.id === "product",
        )!;
        await service.removeEntities({
          kind: "project",
          entries: [{ id: row.data.id, revision: row.revision }],
        });
        const d = await service.dashboard();
        assert.equal(
          d.requirements.filter((r) => r.data.project === "product").length,
          0,
        );
        assert.equal(d.requirementIssues.length, 0);
        assert.equal(d.items.length, 1);
      },
    );
  } finally {
    await store.close();
  }
});
