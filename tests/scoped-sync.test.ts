import assert from "node:assert/strict";
import test from "node:test";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
import { GitHubClient } from "../src/github/client";
import { parseTaskYaml } from "../src/completion/index";
import type { Task } from "../src/core/model";

class FakeGitHub extends GitHubClient {
  collected: string[] = [];
  configs: string[] = [];
  failPR = true;
  override async listOrganizationRepositories() {
    return [{ full_name: "Org/Alpha" }, { full_name: "Org/Beta" }];
  }
  override async get(path: string): Promise<unknown> {
    assert.ok(path.includes("/issues"));
    this.collected.push(path.split("/")[3]!);
    return [];
  }
  override async loadTasks(repository: string) {
    this.configs.push(repository);
    const source = {
      repository,
      branch: "main",
      commitSha: "a".repeat(40),
      path: ".cloud-pm/tasks/task.yaml",
    };
    const definition = parseTaskYaml(
      "version: 1\ntask: TASK-1\nproject: platform\nfeature: login\ncompletion:\n  all:\n    - pull_request:\n        repository: org/alpha\n        number: 1\n        state: merged\n        target_branch: main\n",
    );
    return {
      repository,
      branch: "main",
      commitSha: source.commitSha,
      tasks: repository === "org/beta" ? [{ definition, source }] : [],
      errors: [],
    };
  }
  override async readPullRequest() {
    if (this.failPR) throw new Error("권한 부족");
    return {
      state: "closed" as const,
      mergedAt: "2026-10-20T00:00:00Z",
      targetBranch: "main",
      observedAt: "2026-10-20T01:00:00Z",
    };
  }
}

test("저장소 단위 수집에서도 다른 저장소의 YAML과 완료 조건을 확인한다", async () => {
  const oldOrg = process.env.GITHUB_ORG,
    oldDemo = process.env.DEMO_MODE;
  process.env.GITHUB_ORG = "org";
  delete process.env.DEMO_MODE;
  const store = new Store();
  const client = new FakeGitHub();
  const service = new Service(store, { name: "test", role: "write" }, client);
  try {
    await service.saveProject({
      id: "platform",
      name: "플랫폼",
      goal: "",
      repositories: ["org/alpha", "org/beta"],
    });
    await service.saveFeature({
      id: "login",
      project: "platform",
      name: "로그인",
      goal: "",
    });
    await service.saveTask({
      id: "TASK-1",
      project: "platform",
      feature: "login",
      title: "로그인",
      status: "in_progress",
    });
    const failed = await service.sync({ repositories: ["Org/Alpha"] });
    assert.deepEqual(client.collected, ["alpha"]);
    assert.deepEqual(client.configs, ["org/alpha", "org/beta"]);
    assert.ok(failed.errors.some((e) => e.includes("미확인")));
    assert.equal(
      (await store.get<Task>("task", "TASK-1"))?.data.status,
      "in_progress",
    );
    client.failPR = false;
    client.collected = [];
    client.configs = [];
    const success = await service.sync({ repositories: ["org/alpha"] });
    assert.deepEqual(success.errors, []);
    assert.equal(
      (await store.get<Task>("task", "TASK-1"))?.data.status,
      "done",
    );
    assert.deepEqual(client.collected, ["alpha"]);
    const evaluation = (
      await store.list<{ source: { repository: string } }>("evaluation")
    ).find((e) => e.data.source.repository === "org/beta");
    assert.ok(evaluation);
  } finally {
    await store.close();
    if (oldOrg === undefined) delete process.env.GITHUB_ORG;
    else process.env.GITHUB_ORG = oldOrg;
    if (oldDemo === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = oldDemo;
  }
});

test("프로젝트 지정 동기화는 연결 저장소의 PR·이슈만 수집한다", async () => {
  const oldOrg = process.env.GITHUB_ORG,
    oldDemo = process.env.DEMO_MODE;
  process.env.GITHUB_ORG = "org";
  delete process.env.DEMO_MODE;
  const store = new Store();
  const client = new FakeGitHub();
  const service = new Service(store, { name: "editor", role: "write" }, client);
  try {
    await service.saveProject({
      id: "selected",
      name: "선택",
      goal: "",
      repositories: ["org/alpha"],
    });
    await service.sync({ project: "selected" });
    assert.deepEqual(client.collected, ["alpha"]);
    await assert.rejects(service.sync({ project: "missing" }), /프로젝트/);
    const restricted = new Service(
      store,
      { name: "restricted", role: "write", repositories: ["org/beta"] },
      client,
    );
    await assert.rejects(restricted.sync({ project: "selected" }), /접근|권한/);
  } finally {
    await store.close();
    if (oldOrg === undefined) delete process.env.GITHUB_ORG;
    else process.env.GITHUB_ORG = oldOrg;
    if (oldDemo === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = oldDemo;
  }
});
