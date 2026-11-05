import assert from "node:assert/strict";
import { Store } from "../src/db/store";
import { Users } from "../src/users/service";
import { GitHubOAuth } from "../src/users/github-oauth";
import { GitHubClient } from "../src/github/client";
import { Service } from "../src/core/service";
import { parseGitHubItem } from "../src/github/items";
import type { Task } from "../src/core/model";
assert.ok(process.env.HTTPS_PROXY, "Postman proxy is required");
Object.assign(process.env, {
  APP_URL: "https://pm.example.test",
  GITHUB_ORG: "org",
  GITHUB_OAUTH_CLIENT_ID: "synthetic-client",
  GITHUB_OAUTH_CLIENT_SECRET: "synthetic-secret",
  TOKEN_ENCRYPTION_KEY: "ab".repeat(32),
  DEMO_MODE: "false",
});
const store = new Store(),
  users = new Users(store),
  oauth = new GitHubOAuth(store),
  github = new GitHubClient({ token: "synthetic-installation-token" });
try {
  const local = await users.register({
      login: "pm-test",
      displayName: "PM",
      password: "synthetic-password-123",
    }),
    started = await oauth.start(
      new Request("https://pm.example.test/api/auth/github/start?intent=link", {
        headers: { cookie: `pm_session=${local.token}` },
      }),
    ),
    url = new URL(started.url);
  const control = await fetch("https://api.github.com/__mock/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: "synthetic-code",
      challenge: url.searchParams.get("code_challenge"),
      id: 123,
      login: "developer",
      membership: "active",
    }),
  });
  assert.equal(control.status, 200);
  const callback = new Request(
      `https://pm.example.test/api/auth/github/callback?code=synthetic-code&state=${url.searchParams.get("state")}`,
      {
        headers: {
          cookie: `${started.cookie.split(";")[0]}; pm_session=${local.token}`,
        },
      },
    ),
    linked = await oauth.callback(callback);
  assert.equal(linked.session.user.id, local.user.id);
  assert.equal(linked.session.user.githubId, "123");
  await assert.rejects(oauth.callback(callback), /이미 사용/);
  const service = new Service(
    store,
    {
      name: "pm-test",
      userId: local.user.id,
      workspaceRole: "owner",
      role: "write",
      repositories: ["org/repo"],
      githubTokenProvider: async () => "synthetic-installation-token",
    },
    github,
  );
  await service.saveProject({
    id: "p",
    name: "제품",
    goal: "",
    repositories: ["org/repo"],
  });
  const raw = await github.get("/repos/org/repo/issues/17");
  await store.upsert(
    "github",
    "org/repo#17",
    parseGitHubItem(raw, "org/repo"),
    "fixture",
  );
  await service.saveTask({
    id: "task",
    project: "p",
    title: "API",
    assigneeUserId: local.user.id,
  });
  await service.linkTask("task", "org/repo#17");
  let item = parseGitHubItem(raw, "org/repo"),
    task = (await store.get<Task>("task", "task"))!;
  const changed = await service.updateIssueAssignees({
    item: item.id,
    assignees: ["next-dev"],
    expectedUpdatedAt: item.updatedAt,
    task: { id: task.data.id, revision: task.revision },
  });
  assert.equal(changed.verified, true);
  assert.equal(changed.taskUpdated, true);
  assert.equal(
    (await store.get<Task>("task", "task"))!.data.assignee,
    "next-dev",
  );
  item = changed.item;
  const ignored = await service.updateIssueAssignees({
    item: item.id,
    assignees: ["ignored-dev"],
    expectedUpdatedAt: item.updatedAt,
  });
  assert.equal(ignored.partial, true);
  assert.equal(ignored.verified, false);
  assert.ok(ignored.warning);
  await assert.rejects(
    service.updateIssueAssignees({
      item: item.id,
      assignees: ["developer"],
      expectedUpdatedAt: item.updatedAt,
    }),
    /원본이 변경/,
  );
  const latest = parseGitHubItem(
    await github.get("/repos/org/repo/issues/17"),
    "org/repo",
  );
  await fetch("https://api.github.com/__mock/lose-next-patch", {
    method: "POST",
  });
  await assert.rejects(
    service.updateIssueAssignees({
      item: latest.id,
      assignees: ["developer"],
      expectedUpdatedAt: latest.updatedAt,
    }),
    /응답을 확인하지 못했습니다/,
  );
  const final = parseGitHubItem(
    await github.get("/repos/org/repo/issues/17"),
    "org/repo",
  );
  assert.deepEqual(final.assignees, ["developer"]);
  const state = await (
    await fetch("https://api.github.com/__mock/state")
  ).json();
  assert.equal(state.tokenExchanges, 1);
  assert.equal(state.patches, 3);
  console.log(
    "Planning HTTP simulation passed: PKCE exchange, linked numeric identity, session/state replay guard, actual issue PATCH/GET, internal task update, ignored assignee warning, stale write rejected, write-before-response-loss confirmed without retry",
  );
} finally {
  await store.close();
}
