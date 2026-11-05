import assert from "node:assert/strict";
import test from "node:test";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
import { GitHubClient } from "../src/github/client";
import { parseGitHubItem } from "../src/github/items";
import { DomainError, type Task, type GitHubItem } from "../src/core/model";
test("생성 후 GitHub 이슈 재배정의 원본 확인·권한·부분 성공·불확실한 응답", async (t) => {
  const store = new Store();
  let patches = 0,
    ignored = false,
    loseResponse = false,
    afterPatch: (() => Promise<void>) | null = null;
  let raw = {
    number: 1,
    title: "가입 API",
    body: "본문",
    user: { login: "author" },
    assignees: [{ login: "old-dev" }],
    state: "open",
    html_url: "https://github.com/org/repo/issues/1",
    updated_at: "2026-11-05T01:00:00Z",
  };
  const github = new GitHubClient({
      token: "synthetic-token",
      fetch: async (input, init) => {
        const url = String(input);
        if (url.includes("/assignees/"))
          return new Response(null, {
            status: url.endsWith("/missing-user") ? 404 : 204,
          });
        assert.equal(url, "https://api.github.com/repos/org/repo/issues/1");
        if (!init?.method || init.method === "GET") return Response.json(raw);
        assert.equal(init.method, "PATCH");
        patches++;
        const body = JSON.parse(String(init.body));
        assert.deepEqual(Object.keys(body), ["assignees"]);
        raw = {
          ...raw,
          assignees: ignored
            ? []
            : body.assignees.map((login: string) => ({ login })),
          updated_at: new Date(Date.parse(raw.updated_at) + 1000).toISOString(),
        };
        if (afterPatch) {
          const effect = afterPatch;
          afterPatch = null;
          await effect();
        }
        if (loseResponse) throw new TypeError("synthetic response lost");
        return Response.json(raw);
      },
    }),
    service = new Service(store, { name: "pm", role: "write" }, github);
  const request = (assignees = ["new-dev"]) => ({
    item: "org/repo#1",
    assignees,
    expectedUpdatedAt: raw.updated_at,
  });
  try {
    await service.saveProject({
      id: "product",
      name: "제품",
      goal: "",
      repositories: ["org/repo"],
    });
    await store.upsert(
      "github",
      "org/repo#1",
      parseGitHubItem(raw, "org/repo"),
      "fixture",
    );
    await service.saveTask({
      id: "task",
      project: "product",
      title: "가입",
      assignee: "old-dev",
    });
    await service.linkTask("task", "org/repo#1");
    await t.test(
      "기본 변경은 GitHub와 캐시에 반영하고 내부 태스크는 명시 옵션이 있을 때만 변경한다",
      async () => {
        const result = await service.updateIssueAssignees(request());
        assert.equal(result.verified, true);
        assert.equal(result.partial, false);
        assert.equal(result.taskUpdated, false);
        assert.deepEqual(result.item.assignees, ["new-dev"]);
        assert.equal(
          (await store.get<Task>("task", "task"))!.data.assignee,
          "old-dev",
        );
        assert.deepEqual(
          (await store.get<GitHubItem>("github", "org/repo#1"))!.data.assignees,
          ["new-dev"],
        );
        const task = (await store.get<Task>("task", "task"))!;
        const together = await service.updateIssueAssignees({
          ...request(["together-dev"]),
          task: { id: "task", revision: task.revision },
        });
        assert.equal(together.taskUpdated, true);
        assert.equal(
          (await store.get<Task>("task", "task"))!.data.assignee,
          "together-dev",
        );
      },
    );
    await t.test(
      "원본 변경·배정 불가·권한 없음은 PATCH 전 차단한다",
      async () => {
        const before = patches;
        await assert.rejects(
          service.updateIssueAssignees({
            ...request(),
            expectedUpdatedAt: "2020-01-01T00:00:00Z",
          }),
          (e) => e instanceof DomainError && e.status === 409,
        );
        await assert.rejects(
          service.updateIssueAssignees(request(["missing-user"])),
          /배정할 수 없는/,
        );
        await assert.rejects(
          new Service(
            store,
            { name: "viewer", role: "read" },
            github,
          ).updateIssueAssignees(request()),
          (e) => e instanceof DomainError && e.status === 403,
        );
        await assert.rejects(
          new Service(
            store,
            { name: "hidden", role: "write", repositories: [] },
            github,
          ).updateIssueAssignees(request()),
          (e) => e instanceof DomainError && e.status === 403,
        );
        const row = (await store.get<Task>("task", "task"))!;
        await assert.rejects(
          service.updateIssueAssignees({
            ...request(["a", "b"]),
            task: { id: "task", revision: row.revision },
          }),
          /한 명/,
        );
        assert.equal(patches, before);
      },
    );
    await t.test(
      "원격 성공 뒤 태스크 충돌은 부분 성공으로 남기고 원격을 되돌리지 않는다",
      async () => {
        const task = (await store.get<Task>("task", "task"))!;
        afterPatch = async () => {
          await service.saveTask(
            { ...task.data, title: "다른 사용자가 수정" },
            task.revision,
          );
        };
        const result = await service.updateIssueAssignees({
          ...request(["remote-dev"]),
          task: { id: "task", revision: task.revision },
        });
        assert.equal(result.verified, true);
        assert.equal(result.partial, true);
        assert.equal(result.taskUpdated, false);
        assert.match(result.warning!, /GitHub 담당자는 변경/);
        assert.deepEqual(raw.assignees, [{ login: "remote-dev" }]);
        assert.equal(
          (await store.get<Task>("task", "task"))!.data.assignee,
          "together-dev",
        );
      },
    );
    await t.test(
      "GitHub가 배정을 무시하면 성공으로 숨기지 않고 내부 태스크는 유지한다",
      async () => {
        ignored = true;
        const task = (await store.get<Task>("task", "task"))!;
        const result = await service.updateIssueAssignees({
          ...request(["ignored-dev"]),
          task: { id: "task", revision: task.revision },
        });
        assert.equal(result.verified, false);
        assert.equal(result.partial, true);
        assert.equal(result.taskUpdated, false);
        assert.match(result.warning!, /일부 담당자/);
        ignored = false;
      },
    );
    await t.test(
      "응답 유실 후 자동 재시도하지 않으며 실제 원본 재확인 없이 이전 시각으로 덮어쓰지 않는다",
      async () => {
        const input = request(["lost-response-dev"]),
          before = patches;
        loseResponse = true;
        await assert.rejects(
          service.updateIssueAssignees(input),
          /응답을 확인하지 못했습니다/,
        );
        loseResponse = false;
        assert.equal(patches, before + 1);
        assert.deepEqual(raw.assignees, [{ login: "lost-response-dev" }]);
        await assert.rejects(
          service.updateIssueAssignees(input),
          (e) => e instanceof DomainError && e.status === 409,
        );
        assert.equal(patches, before + 1);
      },
    );
    await t.test(
      "담당자 해제도 승인 연결된 태스크에 명시적으로 반영할 수 있다",
      async () => {
        const task = (await store.get<Task>("task", "task"))!,
          result = await service.updateIssueAssignees({
            ...request([]),
            task: { id: "task", revision: task.revision },
          });
        assert.equal(result.verified, true);
        assert.equal(result.taskUpdated, true);
        assert.deepEqual(result.item.assignees, []);
        assert.equal(
          (await store.get<Task>("task", "task"))!.data.assignee,
          "",
        );
      },
    );
  } finally {
    await store.close();
  }
});
