import assert from "node:assert/strict";
import test from "node:test";
import { GitHubClient } from "../src/github/client";
import { collectRepository } from "../src/github/items";
import { ClaudeProvider } from "../src/ai/provider";

function client(ciFailure = false, checksForbidden = false) {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const u = new URL(String(input));
    calls.push(u.pathname + u.search);
    if (u.pathname.endsWith("/issues"))
      return Response.json([
        {
          number: 1,
          title: "기능",
          body: null,
          user: { login: "author" },
          assignees: [{ login: "assignee" }],
          labels: [{ name: "bug", color: "d73a4a" }, "legacy"],
          state: "open",
          html_url: "https://github.com/org/repo/pull/1",
          updated_at: "2026-10-20T00:00:00Z",
          pull_request: { url: "example" },
        },
      ]);
    if (u.pathname.endsWith("/pulls/1"))
      return Response.json({
        merged_at: null,
        requested_reviewers: [{ login: "reviewer" }],
        requested_teams: [{ slug: "frontend" }],
        changed_files: 2,
        head: { sha: "a".repeat(40) },
      });
    if (u.pathname.endsWith("/status"))
      return Response.json({ state: "success", total_count: 1 });
    if (u.pathname.endsWith("/check-runs"))
      return checksForbidden
        ? new Response("", { status: 403 })
        : Response.json({
            total_count: 1,
            check_runs: [
              {
                status: "completed",
                conclusion: ciFailure ? "failure" : "success",
              },
            ],
          });
    if (u.pathname.endsWith("/files"))
      return Response.json([
        {
          filename: "new.ts",
          previous_filename: "old.ts",
          status: "renamed",
          additions: 1,
          deletions: 1,
          patch: "@@ diff",
        },
      ]);
    if (u.pathname.endsWith("/commits"))
      return Response.json([
        {
          author: { login: "committer" },
          commit: { author: { name: "Local Name" } },
        },
      ]);
    throw new Error("예상하지 못한 요청");
  };
  return { client: new GitHubClient({ fetch: fetcher }), calls };
}

test("PR 역할을 구분하고 파일 이름 변경·누락을 표시한다", async () => {
  const items = await collectRepository(client().client, "org/repo");
  const item = items[0]!;
  assert.equal(item.author, "author");
  assert.deepEqual(item.assignees, ["assignee"]);
  assert.deepEqual(item.reviewers, ["reviewer"]);
  assert.deepEqual(item.reviewerTeams, ["frontend"]);
  assert.deepEqual(item.labels, [
    { name: "bug", color: "d73a4a" },
    { name: "legacy", color: "" },
  ]);
  assert.deepEqual(item.commitAuthors, ["committer"]);
  assert.equal(item.files?.[0]?.previousPath, "old.ts");
  assert.equal(item.filesComplete, false);
  assert.equal(item.ci?.state, "success");
});

test("실패한 검사가 있으면 CI 실패로 표시한다", async () => {
  const items = await collectRepository(client(true).client, "org/repo");
  assert.equal(items[0]?.ci?.state, "failure");
});

test("CI 조회 권한이 없으면 성공으로 단정하지 않는다", async () => {
  const items = await collectRepository(client(false, true).client, "org/repo");
  assert.equal(items[0]?.ci?.state, "unknown");
});

test("조직 저장소 페이지네이션", async () => {
  let calls = 0;
  const c = new GitHubClient({
    fetch: async (input) => {
      calls++;
      const u = new URL(String(input));
      return Response.json(
        u.searchParams.get("page") === "1"
          ? Array.from({ length: 100 }, (_, i) => ({
              full_name: `org/repo${i}`,
            }))
          : [{ full_name: "org/last" }],
      );
    },
  });
  const repos = await c.listOrganizationRepositories("org");
  assert.equal(repos.length, 101);
  assert.equal(calls, 2);
});

test("AI 응답이 잘렸거나 JSON이 아니면 저장하지 않는다", async () => {
  const c = new ClaudeProvider({
    key: "test",
    model: "configured-model",
    fetch: async () =>
      Response.json({
        stop_reason: "max_tokens",
        content: [{ type: "text", text: "{}" }],
      }),
  });
  await assert.rejects(c.json("prompt", {}));
  const malformed = new ClaudeProvider({
    key: "test",
    model: "configured-model",
    fetch: async () =>
      Response.json({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "not-json" }],
      }),
  });
  await assert.rejects(malformed.json("prompt", {}));
});

test("기준일 수집에서도 오래된 열린 작업을 포함하고 중복 PR은 한 번만 읽는다", async () => {
  const fixture = client();
  const items = await collectRepository(fixture.client, "org/repo", {
    since: "2026-09-21T00:00:00Z",
  });
  assert.equal(items.length, 1);
  assert.ok(
    fixture.calls.some((p) => p.includes("since=2026-09-21T00%3A00%3A00Z")),
  );
  assert.ok(fixture.calls.some((p) => p.includes("state=open")));
  assert.equal(
    fixture.calls.filter((p) => p === "/repos/org/repo/pulls/1").length,
    1,
  );
});
