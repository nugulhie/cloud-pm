import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/db/store";
import { Users } from "../src/users/service";
import { Service } from "../src/core/service";
test("워크스페이스 생성·전환·멤버·초대·프로젝트·이력·토큰 격리", async () => {
  const keys = [
      "TOKEN_ENCRYPTION_KEY",
      "GITHUB_ORG",
      "APP_URL",
      "DEMO_MODE",
    ] as const,
    saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.TOKEN_ENCRYPTION_KEY = "88".repeat(32);
  process.env.GITHUB_ORG = "org";
  process.env.APP_URL = "http://localhost";
  delete process.env.DEMO_MODE;
  const store = new Store(),
    users = new Users(store, async (input, init) => {
      const path = new URL(String(input)).pathname,
        login = new Headers(init?.headers)
          .get("authorization")!
          .replace("Bearer ", "");
      if (path === "/user") return Response.json({ login, name: login });
      if (path.includes("/memberships/"))
        return Response.json({ state: "active", role: "member" });
      return Response.json([{ full_name: "org/repo" }]);
    });
  const request = (token: string, workspace?: string) =>
    new Request("http://localhost/api/dashboard", {
      headers: {
        cookie: `pm_session=${token}`,
        ...(workspace ? { "X-Workspace-Id": workspace } : {}),
      },
    });
  try {
    const alice = await users.register({
        githubToken: "alice",
        password: "long-test-password",
      }),
      bob = await users.register({
        githubToken: "bob",
        password: "long-test-password",
      });
    const ar = request(alice.token),
      br = request(bob.token);
    const a = await users.createWorkspace(ar, { name: "플랫폼 팀" }),
      b = await users.createWorkspace(br, { name: "제품 팀" });
    assert.notEqual(a.id, b.id);
    await assert.rejects(users.resolve(request(alice.token, b.id)));
    await assert.rejects(users.switchWorkspace(ar, { id: b.id }));
    await users.switchWorkspace(ar, { id: a.id });
    await users.switchWorkspace(br, { id: b.id });
    const actorA = (await users.resolve(ar)).actor,
      actorB = (await users.resolve(br)).actor;
    assert.equal(actorA.workspaceId, a.id);
    const sa = new Service(store, actorA),
      sb = new Service(store, actorB);
    await sa.saveProject({
      id: "same",
      name: "A 비공개 프로젝트",
      goal: "",
      repositories: ["org/repo"],
    });
    await sb.saveProject({
      id: "same",
      name: "B 비공개 프로젝트",
      goal: "",
      repositories: ["org/repo"],
    });
    await sa.saveFeature({
      id: "same-feature",
      project: "same",
      name: "A 기능",
      goal: "",
    });
    await sa.saveTask({
      id: "SAME-TASK",
      project: "same",
      feature: "same-feature",
      title: "A 태스크",
    });
    assert.equal(
      (await sa.dashboard()).projects[0]?.data.name,
      "A 비공개 프로젝트",
    );
    assert.equal(
      (await sb.dashboard()).projects[0]?.data.name,
      "B 비공개 프로젝트",
    );
    assert.equal((await sb.dashboard()).tasks.length, 0);
    assert.ok(
      !JSON.stringify(await sa.history()).includes("B 비공개 프로젝트"),
    );
    assert.ok(
      !JSON.stringify(await sb.history()).includes("A 비공개 프로젝트"),
    );
    const api = await users.rotateApiToken(ar, "write");
    await users.switchWorkspace(ar, { id: "main" });
    const apiRequest = new Request("http://localhost/api/dashboard", {
      headers: { Authorization: `Bearer ${api.token}` },
    });
    assert.equal((await users.resolve(apiRequest)).actor.workspaceId, a.id);
    await assert.rejects(
      users.resolve(
        new Request("http://localhost/api/dashboard", {
          headers: {
            Authorization: `Bearer ${api.token}`,
            "X-Workspace-Id": "main",
          },
        }),
      ),
    );
    await users.switchWorkspace(ar, { id: a.id });
    const invite = await users.createInvite(ar, { login: "bob" });
    const token = new URLSearchParams(new URL(invite.url).hash.slice(1)).get(
      "invite",
    )!;
    await users.acceptInvite(br, { token });
    assert.equal((await users.resolve(br)).actor.workspaceId, a.id);
    assert.equal((await users.workspace(br)).members.length, 2);
    assert.equal((await users.workspace(br)).admin, false);
    const otherInvite = await users.createInvite(ar, { login: "charlie" });
    const charlie = await users.register({
      githubToken: "charlie",
      password: "long-test-password",
      inviteToken: new URLSearchParams(
        new URL(otherInvite.url).hash.slice(1),
      ).get("invite")!,
    });
    const cr = request(charlie.token);
    assert.deepEqual(
      (await users.listWorkspaces(cr)).workspaces.map((w) => w.id),
      [a.id],
    );
    await assert.rejects(users.resolve(request(charlie.token, "main")));
    await sa.removeEntities({
      kind: "project",
      entries: [{ id: "same", revision: 1 }],
    });
    assert.equal((await sa.dashboard()).projects.length, 0);
    assert.equal(
      (await sb.dashboard()).projects[0]?.data.name,
      "B 비공개 프로젝트",
    );
    const members = await users.workspace(request(bob.token, b.id));
    assert.equal(members.members.length, 1);
    assert.equal(members.invites.length, 0);
  } finally {
    await store.close();
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});
