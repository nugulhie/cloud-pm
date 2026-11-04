import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { stringify } from "yaml";
import { GitHubClient, GitHubError } from "../src/github/client.js";
import { evaluateRepository } from "../src/github/evaluate.js";

const sha = "a".repeat(40);
const definition = {
  version: 1,
  task: "TASK-1",
  project: "platform",
  feature: "login",
  completion: {
    all: [
      {
        pull_request: {
          repository: "org/api",
          number: 1,
          state: "merged",
          target_branch: "main",
        },
      },
    ],
  },
};
function fixture(
  options: {
    duplicate?: boolean;
    invalid?: boolean;
    prStatus?: number;
    listingStatus?: number;
  } = {},
) {
  const requests: string[] = [];
  const headers: Headers[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url.pathname + url.search);
    headers.push(new Headers(init?.headers));
    if (url.pathname === "/repos/org/config")
      return Response.json({ default_branch: "release/main" });
    if (url.pathname.includes("/git/ref/"))
      return Response.json({ object: { type: "commit", sha } });
    if (url.pathname === "/repos/org/config/contents/.cloud-pm/tasks") {
      if (options.listingStatus)
        return new Response("", { status: options.listingStatus });
      return Response.json(
        (options.duplicate ? ["one.yaml", "two.yaml"] : ["one.yaml"]).map(
          (name) => ({ name, path: `.cloud-pm/tasks/${name}`, type: "file" }),
        ),
      );
    }
    if (url.pathname.includes("/contents/")) {
      const text = options.invalid ? "version: 2" : stringify(definition);
      return Response.json({
        type: "file",
        encoding: "base64",
        size: Buffer.byteLength(text),
        content: Buffer.from(text).toString("base64"),
      });
    }
    if (url.pathname === "/repos/org/api/pulls/1") {
      if (options.prStatus)
        return new Response("private response must not leak", {
          status: options.prStatus,
        });
      return Response.json({
        state: "closed",
        merged_at: "2026-10-20T01:00:00Z",
        base: { ref: "main" },
      });
    }
    throw new Error(`예상하지 못한 요청: ${url}`);
  };
  return {
    client: new GitHubClient({
      token: "test-token",
      fetch: fakeFetch,
      rateKey: `fixture:${randomUUID()}`,
    }),
    requests,
    headers,
  };
}

test("기본 브랜치 SHA에 설정을 고정하고 실제 응답 형태로 평가한다", async () => {
  const { client, requests, headers } = fixture();
  const report = await evaluateRepository("org/config", client);
  assert.equal(report.evaluations[0]?.state, "satisfied");
  assert.equal(report.evaluations[0]?.source.commitSha, sha);
  assert.equal(report.branch, "release/main");
  assert.ok(
    requests.includes("/repos/org/config/git/ref/heads/release%2Fmain"),
  );
  assert.ok(
    requests
      .filter((p) => p.includes("/contents/"))
      .every((p) => p.endsWith(`?ref=${sha}`)),
  );
  assert.ok(
    headers.every((h) => h.get("Authorization") === "Bearer test-token"),
  );
});

for (const status of [401, 403, 404, 429, 500])
  test(`PR HTTP ${status}는 미확인으로 반환한다`, async () => {
    const report = await evaluateRepository(
      "org/config",
      fixture({ prStatus: status }).client,
    );
    assert.equal(report.evaluations[0]?.state, "unknown");
    assert.ok(!JSON.stringify(report).includes("private response"));
  });

test("설정 목록 404는 빈 목록으로 숨기지 않는다", async () => {
  await assert.rejects(
    evaluateRepository("org/config", fixture({ listingStatus: 404 }).client),
    GitHubError,
  );
});

test("잘못된 YAML은 파일 오류로 보고하며 평가하지 않는다", async () => {
  const report = await evaluateRepository(
    "org/config",
    fixture({ invalid: true }).client,
  );
  assert.equal(report.errors.length, 1);
  assert.equal(report.evaluations.length, 0);
});

test("중복 태스크는 양쪽 모두 평가에서 제외한다", async () => {
  const { client, requests } = fixture({ duplicate: true });
  const report = await evaluateRepository("org/config", client);
  assert.equal(report.errors.length, 2);
  assert.equal(report.evaluations.length, 0);
  assert.ok(!requests.some((p) => p.includes("/pulls/")));
});

test("유효하지 않은 저장소는 네트워크 호출 전에 거부한다", async () => {
  const { client, requests } = fixture();
  await assert.rejects(client.loadTasks("org/../secret"));
  assert.equal(requests.length, 0);
});

test("커밋 없는 저장소는 빈 YAML 색인이며 일반 409·권한 거부는 숨기지 않는다", async () => {
  const make = (status: number, message: string) =>
    new GitHubClient({
      fetch: async (input) => {
        const path = new URL(String(input)).pathname;
        if (path === "/repos/org/empty")
          return Response.json({ default_branch: "main" });
        assert.equal(path, "/repos/org/empty/git/ref/heads/main");
        return Response.json({ message }, { status });
      },
    });
  const empty = await make(409, "Git Repository is empty.").loadTasks(
    "org/empty",
  );
  assert.deepEqual(empty.tasks, []);
  assert.deepEqual(empty.errors, []);
  await assert.rejects(
    make(409, "Conflict").loadTasks("org/empty"),
    GitHubError,
  );
  await assert.rejects(
    make(403, "Resource not accessible by integration").loadTasks("org/empty"),
    GitHubError,
  );
});
