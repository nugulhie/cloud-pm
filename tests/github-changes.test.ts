import assert from "node:assert/strict";
import test from "node:test";
import { GitHubApp } from "../src/github/app";
import { generateKeyPairSync, createHmac, randomUUID } from "node:crypto";
import { Store } from "../src/db/store";
import { GitHubClient } from "../src/github/client";
import { GitHubChanges, cacheCompletionIndex } from "../src/github/changes";
import { SyncQueue } from "../src/jobs/queue";
import { processNextJob } from "../src/jobs/worker";
import { receiveGithubWebhook } from "../src/webhooks/github";
import { parseTaskYaml } from "../src/completion/index";
import {
  GitHubRateLimitError,
  observeGitHubBudget,
} from "../src/github/rate-limit";
import type { GitHubItem, Task } from "../src/core/model";

const issue = (number = 1) => ({
  number,
  title: "작업",
  body: "내용",
  user: { login: "author" },
  assignees: [{ login: "owner" }],
  labels: [{ name: "feature", color: "112233" }],
  state: "open",
  html_url: `https://github.com/org/repo/issues/${number}`,
  updated_at: "2026-11-03T00:00:00Z",
});
function pr(sha = "a".repeat(40)) {
  return {
    ...issue(),
    html_url: "https://github.com/org/repo/pull/1",
    merged_at: null as string | null,
    head: { sha },
    base: { ref: "main" },
    changed_files: 1,
    requested_reviewers: [{ login: "reviewer" }],
    requested_teams: [],
  };
}
async function deliver(store: Store, event: string, data: object) {
  const text = JSON.stringify({
    repository: { full_name: "org/repo", default_branch: "main" },
    ...data,
  });
  const id = randomUUID();
  await receiveGithubWebhook(
    new Request("http://localhost/api/webhooks/github", {
      method: "POST",
      headers: {
        "x-github-event": event,
        "x-github-delivery": id,
        "x-hub-signature-256": `sha256=${createHmac("sha256", "test").update(text).digest("hex")}`,
      },
      body: text,
    }),
    new SyncQueue(store),
    { secret: "test", organization: "org" },
  );
  return id;
}

test("웹훅은 변경 항목만 반영하고 PR 커밋이 같으면 diff를 다시 조회하지 않는다", async () => {
  const store = new Store();
  const calls: string[] = [];
  const client = new GitHubClient({
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      if (path.endsWith("/files"))
        return Response.json([
          {
            filename: "src/a.ts",
            status: "modified",
            additions: 1,
            deletions: 1,
            patch: "@@\n-old\n+new",
          },
        ]);
      if (path.endsWith("/commits"))
        return Response.json([
          { author: { login: "dev" }, commit: { author: { name: "Dev" } } },
        ]);
      if (path.endsWith("/status"))
        return Response.json({ state: "success", total_count: 1 });
      if (path.endsWith("/check-runs"))
        return Response.json({ total_count: 0, check_runs: [] });
      throw new Error(`Unexpected API: ${path}`);
    },
  });
  const changes = new GitHubChanges(store, client);
  const work = () => processNextJob(store, (_r, job) => changes.process(job));
  try {
    await deliver(store, "issues", {
      action: "opened",
      issue: issue(2),
      sender: { private_data: "not stored" },
    });
    assert.equal((await work())?.status, "completed");
    assert.equal(calls.length, 0);
    const rawJobs = await store.query<{ payload: object }>(
      "SELECT payload FROM sync_jobs",
    );
    assert.ok(!JSON.stringify(rawJobs).includes("private_data"));
    const pull = pr();
    await deliver(store, "pull_request", {
      action: "opened",
      pull_request: pull,
    });
    assert.equal((await work())?.status, "completed");
    assert.equal(calls.length, 4);
    assert.ok(
      calls.every(
        (path) =>
          path.includes("/pulls/1/") ||
          path.includes(`/commits/${pull.head.sha}/`),
      ),
    );
    calls.length = 0;
    // GitHub의 실제 review 이벤트는 changed_files를 생략한다.
    const { changed_files: omitted, ...reviewPayload } = pull;
    await deliver(store, "pull_request_review", {
      action: "submitted",
      pull_request: reviewPayload,
    });
    assert.equal((await work())?.status, "completed");
    assert.equal(calls.length, 0);
    await deliver(store, "pull_request_review_comment", {
      action: "created",
      pull_request: reviewPayload,
    });
    assert.equal((await work())?.status, "completed");
    assert.equal(calls.length, 0);
    await deliver(store, "pull_request", {
      action: "labeled",
      pull_request: {
        ...pull,
        labels: [{ name: "approved", color: "00ff00" }],
      },
    });
    assert.equal((await work())?.status, "completed");
    assert.equal(calls.length, 0);
    const saved = (await store.get<GitHubItem>("github", "org/repo#1"))!.data;
    assert.equal(saved.files?.[0]?.patch, "@@\n-old\n+new");
    assert.equal(saved.labels?.[0]?.name, "approved");
    await deliver(store, "pull_request", {
      action: "synchronize",
      pull_request: pr("b".repeat(40)),
    });
    assert.equal((await work())?.status, "completed");
    assert.equal(calls.length, 4);
    calls.length = 0;
    await deliver(store, "issues", {
      issue: { ...issue(2), title: "옛날", updated_at: "2026-11-02T00:00:00Z" },
    });
    await work();
    assert.equal(
      (await store.get<GitHubItem>("github", "org/repo#2"))?.data.title,
      "작업",
    );
    assert.equal(calls.length, 0);
  } finally {
    await store.close();
  }
});

test("다른 저장소 YAML 완료 조건도 캐시로 평가하고 머지 이벤트는 GitHub 조회 없이 완료한다", async () => {
  const store = new Store();
  const changes = new GitHubChanges(
    store,
    new GitHubClient({
      fetch: async () => {
        throw new Error("No API expected");
      },
    }),
  );
  try {
    await store.save(
      "project",
      "p",
      { id: "p", repositories: ["org/repo", "org/config"] },
      "test",
    );
    await store.save(
      "task",
      "T-1",
      { id: "T-1", project: "p", feature: "f", status: "in_progress" },
      "test",
    );
    const definition = parseTaskYaml(
      "version: 1\ntask: T-1\nproject: p\nfeature: f\ncompletion:\n  all:\n    - pull_request:\n        repository: org/repo\n        number: 1\n        state: merged\n        target_branch: main\n",
    );
    await cacheCompletionIndex(store, {
      repository: "org/config",
      branch: "main",
      commitSha: "c".repeat(40),
      errors: [],
      tasks: [
        {
          definition,
          source: {
            repository: "org/config",
            branch: "main",
            commitSha: "c".repeat(40),
            path: ".cloud-pm/tasks/task.yaml",
          },
        },
      ],
    });
    // 이미 수집된 동일 커밋의 diff/CI
    const item: GitHubItem = {
      id: "org/repo#1",
      repository: "org/repo",
      number: 1,
      kind: "pr",
      title: "PR",
      body: "",
      author: "dev",
      reviewers: [],
      assignees: [],
      state: "open",
      url: "https://github.com/org/repo/pull/1",
      updatedAt: issue().updated_at,
      headSha: "a".repeat(40),
      filesHeadSha: "a".repeat(40),
      ciHeadSha: "a".repeat(40),
      files: [],
      filesComplete: true,
    };
    await store.save("github", item.id, item, "test");
    await deliver(store, "pull_request", {
      action: "closed",
      pull_request: {
        ...pr(),
        state: "closed",
        merged_at: "2026-11-03T01:00:00Z",
        updated_at: "2026-11-03T01:00:00Z",
      },
    });
    assert.equal(
      (await processNextJob(store, (_r, job) => changes.process(job)))?.status,
      "completed",
    );
    assert.equal((await store.get<Task>("task", "T-1"))?.data.status, "done");
    await deliver(store, "issue_comment", {
      issue: {
        ...issue(),
        pull_request: {},
        state: "closed",
        updated_at: "2026-11-03T02:00:00Z",
      },
    });
    await processNextJob(store, (_r, job) => changes.process(job));
    assert.equal(
      (await store.get<GitHubItem>("github", item.id))?.data.state,
      "merged",
    );
  } finally {
    await store.close();
  }
});

test("한도 초과는 재설정까지 대기하며 재시도 횟수를 소진하지 않고 일반 이슈는 계속 반영한다", async () => {
  const store = new Store();
  const queue = new SyncQueue(store);
  let calls = 0;
  const key = `unit:${randomUUID()}`;
  const retryAt = Math.floor(Date.now() / 1000) + 3600;
  const client = new GitHubClient({
    rateKey: key,
    fetch: async () => {
      calls++;
      return Response.json(
        { message: "API rate limit exceeded" },
        {
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(retryAt),
          },
        },
      );
    },
  });
  const changes = new GitHubChanges(store, client);
  try {
    const id = await deliver(store, "pull_request", { pull_request: pr() });
    assert.equal(
      (await processNextJob(store, (_r, job) => changes.process(job)))?.status,
      "pending",
    );
    const [job] = await store.query<{ attempts: number; available_at: string }>(
      "SELECT attempts,available_at FROM sync_jobs WHERE id=$1",
      [id],
    );
    assert.equal(job?.attempts, 0);
    assert.ok(new Date(job!.available_at).getTime() >= retryAt * 1000);
    assert.equal(
      (await store.get<GitHubItem>("github", "org/repo#1"))?.data.title,
      "작업",
    );
    await deliver(store, "issues", { issue: issue(2) });
    assert.equal(
      (await processNextJob(store, (_r, job) => changes.process(job)))?.status,
      "completed",
    );
    await assert.rejects(client.get("/repos/org/repo"), GitHubRateLimitError);
    assert.equal(calls, 1);
    assert.equal(
      (await queue.list()).find((j) => j.id === id)?.status,
      "pending",
    );
    await assert.rejects(
      observeGitHubBudget(
        Response.json(
          { message: "secondary rate limit" },
          { status: 429, headers: { "retry-after": "180" } },
        ),
      ),
      (e) =>
        e instanceof GitHubRateLimitError && e.retryAt >= Date.now() + 179000,
    );
    // 일반 권한 거부는 대기 상태로 오인하지 않는다.
    await assert.doesNotReject(
      observeGitHubBudget(
        Response.json(
          { message: "Resource not accessible by integration" },
          { status: 403 },
        ),
      ),
    );
  } finally {
    await store.close();
  }
});

test("CI 중복은 성공 후에만 묶어 완료하고 처리 중 새 이벤트는 남긴다", async () => {
  const store = new Store();
  const queue = new SyncQueue(store);
  try {
    const payload = {
      version: 1 as const,
      type: "ci" as const,
      sha: "a".repeat(40),
      numbers: [1],
    };
    await queue.enqueue("one", "check_run", "org/repo", payload);
    await queue.enqueue("two", "status", "org/repo", payload);
    await store.query(
      "UPDATE sync_jobs SET available_at=now()-interval '1 second'",
    );
    const job = (await queue.claim())!;
    await queue.enqueue("new", "check_run", "org/repo", payload);
    await queue.finish(job);
    const rows = await queue.list();
    assert.equal(rows.find((r) => r.id === "one")?.status, "completed");
    assert.equal(rows.find((r) => r.id === "two")?.status, "completed");
    assert.equal(rows.find((r) => r.id === "new")?.status, "pending");
  } finally {
    await store.close();
  }
});

test("구버전 큐는 저장소별 변경분을 한 번 조회해 복구하고 재시작 때 전체 동기화를 만들지 않는다", async () => {
  const store = new Store();
  const queue = new SyncQueue(store);
  const calls: string[] = [];
  const client = new GitHubClient({
    fetch: async (input) => {
      calls.push(String(input));
      return Response.json([]);
    },
  });
  const changes = new GitHubChanges(store, client);
  try {
    await queue.enqueue("old-one", "issues", "org/repo");
    await queue.enqueue("old-two", "pull_request", "org/repo");
    await store.query("UPDATE sync_jobs SET status='failed',attempts=5");
    await queue.recoverLegacy();
    assert.equal(
      (await processNextJob(store, (_r, job) => changes.process(job)))?.status,
      "completed",
    );
    assert.equal(calls.length, 1);
    assert.ok(calls[0]!.includes("since="));
    assert.equal(
      (await queue.list()).filter((j) => j.status === "completed").length,
      2,
    );
    await queue.recoverLegacy();
    assert.equal(await queue.claim(), undefined);
  } finally {
    await store.close();
  }
});

test("한도 재설정 뒤 재개하고 백그라운드가 남겨 둔 예산은 사용자 요청에 쓸 수 있다", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1800000000000 });
  const key = `reset:${randomUUID()}`;
  let calls = 0;
  const make = (reserve: number) =>
    new GitHubClient({
      rateKey: key,
      reserve,
      fetch: async () => {
        calls++;
        return Response.json(
          {},
          {
            headers: {
              "x-ratelimit-remaining": "150",
              "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60),
            },
          },
        );
      },
    });
  await make(200).get("/fixture");
  await assert.rejects(make(200).get("/fixture"), GitHubRateLimitError);
  assert.equal(calls, 1);
  await make(0).get("/fixture");
  assert.equal(calls, 2);
  t.mock.timers.tick(62000);
  await make(200).get("/fixture");
  assert.equal(calls, 3);
});

test("재시작은 누락된 YAML 색인 작업만 한 번 등록한다", async () => {
  const store = new Store();
  const old = process.env.GITHUB_ORG;
  process.env.GITHUB_ORG = "org";
  const changes = new GitHubChanges(
    store,
    new GitHubClient({
      fetch: async () => {
        throw new Error("No API expected");
      },
    }),
  );
  try {
    await store.save("repository", "org/repo", { name: "org/repo" }, "test");
    await changes.bootstrap();
    await changes.bootstrap();
    const jobs = await new SyncQueue(store).list();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.event, "config_bootstrap");
    assert.equal(jobs[0]?.repository, "org/repo");
  } finally {
    await store.close();
    if (old === undefined) delete process.env.GITHUB_ORG;
    else process.env.GITHUB_ORG = old;
  }
});

test("App 요청 제한은 정상 설치 토큰을 무효화하거나 재발급하지 않는다", async () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  let now = Date.now(),
    issued = 0,
    limited = false;
  const app = new GitHubApp({
    appId: "999991",
    installationId: "999992",
    organization: "org",
    privateKey,
    now: () => now,
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/app/installations/999992")
        return Response.json({
          id: 999992,
          app_id: 999991,
          account: { login: "org" },
          suspended_at: null,
        });
      if (path.endsWith("/access_tokens")) {
        issued++;
        return Response.json({
          token: "simulation-token",
          expires_at: new Date(now + 3600000).toISOString(),
        });
      }
      if (path === "/installation/repositories")
        return limited
          ? Response.json(
              { message: "API rate limit exceeded" },
              {
                status: 403,
                headers: {
                  "x-ratelimit-remaining": "0",
                  "x-ratelimit-reset": String(
                    Math.floor(Date.now() / 1000) + 3600,
                  ),
                },
              },
            )
          : Response.json({ repositories: [{ full_name: "org/repo" }] });
      throw new Error("Unexpected App path");
    },
  });
  await app.access();
  limited = true;
  now += 61000;
  await assert.rejects(app.access(), GitHubRateLimitError);
  assert.equal(await app.token(), "simulation-token");
  assert.equal(issued, 1);
});

test("수동 수집 중인 웹훅은 재시도 횟수 소진 없이 대기했다가 이어서 처리한다", async () => {
  const { acquireSyncLease } = await import("../src/jobs/lease");
  const store = new Store();
  const changes = new GitHubChanges(
    store,
    new GitHubClient({
      fetch: async () => {
        throw new Error("No API expected");
      },
    }),
  );
  const lease = await acquireSyncLease(store);
  try {
    const id = await deliver(store, "issues", { issue: issue(2) });
    assert.equal(
      (await processNextJob(store, (_r, job) => changes.process(job)))?.status,
      "pending",
    );
    assert.equal((await new SyncQueue(store).list())[0]?.attempts, 0);
    assert.equal(await store.get("github", "org/repo#2"), undefined);
    await lease.close();
    await store.query("UPDATE sync_jobs SET available_at=now() WHERE id=$1", [
      id,
    ]);
    assert.equal(
      (await processNextJob(store, (_r, job) => changes.process(job)))?.status,
      "completed",
    );
    assert.ok(await store.get("github", "org/repo#2"));
  } finally {
    await lease.close();
    await store.close();
  }
});

test("최초 수신이 파일 수 없는 리뷰여도 해당 PR 상세만 조회해 diff를 보충한다", async () => {
  const store = new Store();
  const paths: string[] = [];
  const client = new GitHubClient({
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      if (path.endsWith("/pulls/1"))
        return Response.json({ ...pr(), changed_files: 0 });
      if (path.endsWith("/files") || path.endsWith("/commits"))
        return Response.json([]);
      if (path.endsWith("/status"))
        return Response.json({ state: "success", total_count: 1 });
      if (path.endsWith("/check-runs"))
        return Response.json({ total_count: 0, check_runs: [] });
      throw new Error(`Unexpected API: ${path}`);
    },
  });
  const changes = new GitHubChanges(store, client);
  try {
    const { changed_files: omitted, ...reviewPayload } = pr();
    await deliver(store, "pull_request_review", {
      pull_request: reviewPayload,
    });
    assert.equal(
      (await processNextJob(store, (_r, job) => changes.process(job)))?.status,
      "completed",
    );
    assert.equal(paths.length, 5);
    assert.ok(
      paths.every(
        (path) =>
          path.includes("/pulls/1") ||
          path.includes(`/commits/${pr().head.sha}/`),
      ),
    );
    assert.equal(
      (await store.get<GitHubItem>("github", "org/repo#1"))?.data.filesComplete,
      true,
    );
  } finally {
    await store.close();
  }
});

test("이슈·PR 편집은 원문 필드를 갱신하고 태스크 연결과 내부 설명을 보존한다", async () => {
  const store = new Store();
  const changes = new GitHubChanges(
    store,
    new GitHubClient({
      fetch: async () => {
        throw new Error("Metadata edits must not call GitHub");
      },
    }),
  );
  const work = () => processNextJob(store, (_r, job) => changes.process(job));
  try {
    await store.save(
      "task",
      "T-edit",
      {
        id: "T-edit",
        project: "p",
        title: "PM이 관리하는 작업",
        description: "내부 기획 설명",
        status: "in_progress",
      },
      "test",
    );
    for (const number of [1, 2]) {
      const record =
        number === 1 ? { ...issue(1), pull_request: {} } : issue(2);
      const normalized = (await import("../src/github/items")).parseGitHubItem(
        record,
        "org/repo",
      );
      await store.save(
        "github",
        normalized.id,
        {
          ...normalized,
          ...(number === 1
            ? {
                headSha: "a".repeat(40),
                filesHeadSha: "a".repeat(40),
                ciHeadSha: "a".repeat(40),
                files: [],
                filesComplete: true,
              }
            : {}),
        },
        "test",
      );
      await store.save(
        "link",
        `T-edit:${normalized.id}`,
        {
          id: `T-edit:${normalized.id}`,
          task: "T-edit",
          item: normalized.id,
          status: "approved",
          reason: "PRD에서 이슈 생성",
          method: "manual",
        },
        "test",
      );
      const updated = {
        ...issue(number),
        title: "GitHub에서 수정한 제목",
        body: "## 수정한 Markdown",
        assignees: [{ login: "new-owner" }],
        labels: [{ name: "bug", color: "ff0000" }],
        updated_at: "2026-11-04T00:00:00Z",
      };
      await deliver(
        store,
        number === 1 ? "pull_request" : "issues",
        number === 1
          ? {
              action: "edited",
              pull_request: {
                ...pr(),
                ...updated,
                requested_reviewers: [{ login: "new-reviewer" }],
              },
            }
          : { action: "edited", issue: updated },
      );
      assert.equal((await work())?.status, "completed");
      const saved = (await store.get<GitHubItem>("github", normalized.id))!
        .data;
      assert.equal(saved.title, updated.title);
      assert.equal(saved.body, updated.body);
      assert.deepEqual(saved.assignees, ["new-owner"]);
      assert.deepEqual(saved.labels, [{ name: "bug", color: "ff0000" }]);
      if (number === 1) assert.deepEqual(saved.reviewers, ["new-reviewer"]);
      assert.equal(
        (await store.get<{ status: string }>("link", `T-edit:${normalized.id}`))
          ?.data.status,
        "approved",
      );
      const closed = {
        ...updated,
        state: "closed",
        assignees: [],
        labels: [],
        updated_at: "2026-11-04T00:01:00Z",
      };
      await deliver(
        store,
        number === 1 ? "pull_request" : "issues",
        number === 1
          ? {
              action: "closed",
              pull_request: { ...pr(), ...closed, requested_reviewers: [] },
            }
          : { action: "closed", issue: closed },
      );
      assert.equal((await work())?.status, "completed");
      const cleared = (await store.get<GitHubItem>("github", normalized.id))!
        .data;
      assert.equal(cleared.state, "closed");
      assert.deepEqual(cleared.assignees, []);
      assert.deepEqual(cleared.labels, []);
      if (number === 1) assert.deepEqual(cleared.reviewers, []);
      const reopened = {
        ...closed,
        state: "open",
        updated_at: "2026-11-04T00:02:00Z",
      };
      await deliver(
        store,
        number === 1 ? "pull_request" : "issues",
        number === 1
          ? {
              action: "reopened",
              pull_request: { ...pr(), ...reopened, requested_reviewers: [] },
            }
          : { action: "reopened", issue: reopened },
      );
      assert.equal((await work())?.status, "completed");
      assert.equal(
        (await store.get<GitHubItem>("github", normalized.id))?.data.state,
        "open",
      );
    }
    const task = (await store.get<Task>("task", "T-edit"))!.data;
    assert.equal(task.title, "PM이 관리하는 작업");
    assert.equal(task.description, "내부 기획 설명");
  } finally {
    await store.close();
  }
});
