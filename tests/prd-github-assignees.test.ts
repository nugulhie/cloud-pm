import assert from "node:assert/strict";
import test from "node:test";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
import { GitHubClient } from "../src/github/client";
import { DomainError } from "../src/core/model";
import { repositoryAssignees } from "../src/github/assignee-cache";

test("GitHub 담당자 페이지·봇 제외·프로젝트/저장소 제한과 이슈의 실제 Assignees 전달", async () => {
  const store = new Store();
  let writes = 0,
    allowed = true,
    omit = false,
    readFailure = false;
  const sent: any[] = [];
  const client = new GitHubClient({
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/assignees")) {
        if (readFailure) return Response.json({}, { status: 403 });
        return Response.json(
          url.searchParams.get("page") === "1"
            ? [
                ...Array.from({ length: 99 }, (_, i) => ({
                  login: `user-${i}`,
                  type: "User",
                })),
                { login: "helper[bot]", type: "Bot" },
              ]
            : [{ login: "developer", type: "User" }],
        );
      }
      if (url.pathname.includes("/assignees/"))
        return new Response(null, { status: allowed ? 204 : 404 });
      assert.equal(url.pathname, "/repos/org/repo/issues");
      assert.equal(init?.method, "POST");
      writes++;
      const data = JSON.parse(String(init?.body));
      sent.push(data);
      return Response.json(
        {
          number: 100 + writes,
          title: data.title,
          body: data.body,
          user: { login: "app[bot]" },
          html_url: `https://github.com/org/repo/issues/${100 + writes}`,
          updated_at: new Date().toISOString(),
          assignees: omit
            ? []
            : (data.assignees ?? []).map((login: string) => ({ login })),
        },
        { status: 201 },
      );
    },
  });
  const service = new Service(
    store,
    {
      name: "pm",
      role: "write",
      repositories: ["org/repo"],
      githubToken: "synthetic",
    },
    client,
  );
  try {
    await service.saveProject({
      id: "p",
      name: "Product",
      goal: "",
      repositories: ["org/repo"],
      featurePrefix: "PRODT",
    });
    const people = await service.listGitHubAssignees({ project: "p" });
    assert.equal(people.users.length, 100);
    assert.ok(people.users.some((u) => u.login === "developer"));
    assert.ok(!people.users.some((u) => u.login.includes("[bot]")));
    await service.saveProject({
      id: "without-repo",
      name: "Asana 프로젝트",
      goal: "",
      repositories: [],
    });
    const fallback = await service.listGitHubAssignees({
      project: "without-repo",
    });
    assert.equal(fallback.scope, "workspace");
    assert.ok(fallback.users.some((user) => user.login === "developer"));
    await assert.rejects(
      service.listGitHubAssignees({ project: "p", repository: "org/secret" }),
      (e) => e instanceof DomainError && e.status === 403,
    );
    const outsider = new Service(
      store,
      { name: "out", role: "read", repositories: [] },
      client,
    );
    await assert.rejects(
      outsider.listGitHubAssignees({ project: "p" }),
      (e) => e instanceof DomainError && e.status === 403,
    );
    async function ready(id: string, assignee = "developer") {
      const row = (await service.saveRequirement({
        id,
        project: "p",
        featureName: "초대",
        assignee,
      }))!;
      await service.convertRequirements({
        entries: [{ id, revision: row.revision }],
      });
      return (await service.dashboard()).requirements.find(
        (r) => r.data.id === id,
      )!;
    }
    const row = await ready("r1");
    const preview = await service.previewRequirementIssue({
      id: "r1",
      revision: row.revision,
      repository: "org/repo",
    });
    await assert.rejects(
      service.publishRequirementIssue({
        id: "r1",
        revision: row.revision,
        repository: "org/repo",
        assignee: "other",
        previewHash: preview.previewHash,
      }),
      (e) => e instanceof DomainError && e.status === 409,
    );
    assert.equal(writes, 0);
    allowed = false;
    await assert.rejects(
      service.publishRequirementIssue({
        id: "r1",
        revision: row.revision,
        repository: "org/repo",
        previewHash: preview.previewHash,
      }),
      /배정할 수 없는/,
    );
    assert.equal(writes, 0);
    assert.equal(await store.get("requirement-issue", "r1"), undefined);
    allowed = true;
    const result = await service.publishRequirementIssue({
      id: "r1",
      revision: row.revision,
      repository: "org/repo",
      previewHash: preview.previewHash,
    });
    assert.equal(result.state, "created");
    assert.deepEqual(sent[0].assignees, ["developer"]);
    assert.equal(result.assignmentWarning, undefined);
    assert.deepEqual((await service.dashboard()).items[0]!.data.assignees, [
      "developer",
    ]);
    allowed = false;
    assert.equal(
      (
        await service.publishRequirementIssue({
          id: "r1",
          revision: row.revision,
          repository: "org/repo",
        })
      ).number,
      result.number,
    );
    assert.equal(writes, 1);
    allowed = true;
    omit = true;
    const second = await ready("r2", "기존 입력 이름");
    await assert.rejects(
      service.previewRequirementIssue({
        id: "r2",
        revision: second.revision,
        repository: "org/repo",
      }),
      /GitHub 사용자/,
    );
    const issued = await service.publishRequirementIssue({
      id: "r2",
      revision: second.revision,
      repository: "org/repo",
      assignee: "developer",
    });
    assert.ok(issued.assignmentWarning);
    assert.equal(issued.state, "created");
    assert.equal(writes, 2);
    await service.publishRequirementIssue({
      id: "r2",
      revision: second.revision,
      repository: "org/repo",
      assignee: "developer",
    });
    assert.equal(writes, 2);
    readFailure = true;
    await assert.rejects(
      service.listGitHubAssignees({ project: "p" }),
      /목록을 불러오지 못했습니다/,
    );
  } finally {
    await store.close();
  }
});

test("GitHub 담당자 캐시는 인증별로 격리하고 실패한 결과를 재사용하지 않는다", async () => {
  let calls = 0,
    fail = false;
  const client = new GitHubClient({
    fetch: async () => {
      calls++;
      if (fail) return Response.json({}, { status: 403 });
      return Response.json([{ login: `user-${calls}`, type: "User" }]);
    },
  });
  const [a, b] = await Promise.all([
    repositoryAssignees(client, "org/cache", "first-credential"),
    repositoryAssignees(client, "org/cache", "first-credential"),
  ]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  const other = await repositoryAssignees(
    client,
    "org/cache",
    "other-credential",
  );
  assert.notDeepEqual(a, other);
  assert.equal(calls, 2);
  fail = true;
  await assert.rejects(
    repositoryAssignees(client, "org/cache", "failed-credential"),
  );
  fail = false;
  await repositoryAssignees(client, "org/cache", "failed-credential");
  assert.equal(calls, 4);
});
