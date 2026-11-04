import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/db/store";
import { Users } from "../src/users/service";
import { Workspaces } from "../src/workspaces/service";
import { Service } from "../src/core/service";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server";

test("워크스페이스 역할·초대·토큰 하향 적용·소유자 보호와 멤버 제외", async () => {
  const keys = [
    "TOKEN_ENCRYPTION_KEY",
    "GITHUB_ORG",
    "APP_URL",
    "DEMO_MODE",
  ] as const;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.TOKEN_ENCRYPTION_KEY = "88".repeat(32);
  process.env.GITHUB_ORG = "org";
  process.env.APP_URL = "http://localhost";
  delete process.env.DEMO_MODE;
  const testUrl = process.env.ROLE_TEST_DATABASE_URL;
  if (
    testUrl &&
    !new URL(testUrl).pathname.startsWith("/cloud_pm_roles_check_")
  )
    throw new Error("권한 검증은 임시 DB에서만 실행합니다.");
  const store = new Store(testUrl);
  const users = new Users(store, async (input, init) => {
    const path = new URL(String(input)).pathname;
    const login =
      new Headers(init?.headers).get("authorization")?.replace("Bearer ", "") ??
      "";
    if (path === "/user") return Response.json({ login, name: login });
    if (path.includes("/memberships/"))
      return Response.json({
        state: "active",
        role: login === "githubadmin" ? "admin" : "member",
      });
    return Response.json([{ full_name: "org/repo" }]);
  });
  const req = (token: string, api = false, workspace?: string) =>
    new Request("http://localhost/api/auth/workspace", {
      headers: {
        ...(api
          ? { authorization: `Bearer ${token}` }
          : { cookie: `pm_session=${token}` }),
        ...(workspace ? { "X-Workspace-Id": workspace } : {}),
      },
    });
  const register = (login: string, inviteToken?: string) =>
    users.register({
      githubToken: login,
      password: "long-test-password",
      ...(inviteToken ? { inviteToken } : {}),
    });
  try {
    const owner = await register("owner"),
      admin = await register("admin"),
      member = await register("member"),
      viewer = await register("githubadmin");
    const o = req(owner.token),
      a = req(admin.token),
      m = req(member.token),
      v = req(viewer.token);
    await users.updateMember(o, {
      userId: admin.user.id,
      expectedRole: "member",
      role: "admin",
    });
    assert.equal((await users.workspace(a)).role, "admin");
    const privateSpace = await users.createWorkspace(o, {
      name: "별도 권한 공간",
    });
    const privateInvite = await users.createInvite(
      req(owner.token, false, privateSpace.id),
      { login: "admin", role: "viewer" },
    );
    await users.acceptInvite(a, {
      token: new URLSearchParams(new URL(privateInvite.url).hash.slice(1)).get(
        "invite",
      )!,
    });
    assert.equal((await users.resolve(a)).actor.workspaceRole, "viewer");
    await users.switchWorkspace(a, { id: "main" });
    assert.equal((await users.resolve(a)).actor.workspaceRole, "admin");
    await assert.rejects(
      users.updateMember(a, {
        userId: member.user.id,
        expectedRole: "member",
        role: "admin",
      }),
      /소유자/,
    );
    await assert.rejects(
      users.updateMember(m, {
        userId: viewer.user.id,
        expectedRole: "member",
        role: "viewer",
      }),
      /관리자/,
    );
    await assert.rejects(
      users.updateMember(o, {
        userId: owner.user.id,
        expectedRole: "owner",
        role: "viewer",
      }),
      /소유자/,
    );
    await assert.rejects(
      users.removeMember(a, { userId: owner.user.id, expectedRole: "owner" }),
      /소유자/,
    );
    await assert.rejects(
      users.removeMember(a, { userId: admin.user.id, expectedRole: "admin" }),
      /소유자/,
    );
    const oldToken = await users.rotateApiToken(m, "write");
    await users.updateMember(a, {
      userId: member.user.id,
      expectedRole: "member",
      role: "viewer",
    });
    assert.equal(
      (await users.resolve(req(oldToken.token, true))).actor.role,
      "read",
    );
    await assert.rejects(
      users.updateMember(o, {
        userId: member.user.id,
        expectedRole: "member",
        role: "admin",
      }),
      /변경/,
    );
    await users.updateMember(o, {
      userId: viewer.user.id,
      expectedRole: "member",
      role: "viewer",
    });
    assert.equal((await users.resolve(v)).actor.admin, true);
    assert.equal((await users.workspace(v)).admin, false);
    await assert.rejects(users.createInvite(v, {}), /관리자/);
    await assert.rejects(users.rotateApiToken(v, "write"), /조회 전용/);
    const readerToken = await users.rotateApiToken(v, "read");
    assert.equal(
      (await users.resolve(req(readerToken.token, true))).actor.role,
      "read",
    );
    const ownerService = new Service(store, (await users.resolve(o)).actor);
    await ownerService.saveProject({
      id: "p",
      name: "제품",
      goal: "",
      repositories: ["org/repo"],
    });
    await ownerService.saveFeature({
      id: "f",
      project: "p",
      name: "기능",
      goal: "",
    });
    await ownerService.saveTask({
      id: "t",
      project: "p",
      feature: "f",
      title: "작업",
      assignee: "githubadmin",
    });
    const comment = (await ownerService.saveComment({
      task: "t",
      body: "@githubadmin 확인 요청",
    }))!;
    const reader = new Service(store, (await users.resolve(v)).actor);
    assert.equal((await reader.dashboard()).tasks.length, 1);
    await assert.rejects(
      reader.saveTask({ id: "bad", project: "p", feature: "f", title: "금지" }),
      /수정 권한/,
    );
    await assert.rejects(
      reader.saveComment({ task: "t", body: "금지" }),
      /수정 권한/,
    );
    await reader.readNotification({
      id: comment.data.id,
      revision: comment.revision,
    });
    assert.equal((await reader.listNotifications()).unread, 0);
    const server = createMcpServer(reader),
      client = new Client({ name: "reader-role-test", version: "1" });
    const [x, y] = InMemoryTransport.createLinkedPair();
    await server.connect(x);
    await client.connect(y);
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      assert.ok(names.includes("list_tasks"));
      assert.ok(names.includes("mark_notification_read"));
      assert.ok(!names.includes("update_task"));
      assert.ok(!names.includes("add_task_comment"));
    } finally {
      await client.close();
      await server.close();
    }
    await users.updateMember(o, {
      userId: member.user.id,
      expectedRole: "viewer",
      role: "member",
    });
    assert.equal(
      (await users.resolve(req(oldToken.token, true))).actor.role,
      "write",
    );
    const another = await users.createWorkspace(m, { name: "다른 공간" });
    await assert.rejects(
      users.updateMember(req(owner.token, false, another.id), {
        userId: member.user.id,
        expectedRole: "owner",
        role: "viewer",
      }),
      /접근 권한/,
    );
    await assert.rejects(
      users.updateMember(req(oldToken.token, true), {
        userId: viewer.user.id,
        expectedRole: "viewer",
        role: "member",
      }),
      /브라우저/,
    );
    const invite = await users.createInvite(a, {
      login: "guest",
      role: "viewer",
    });
    const inviteToken = new URLSearchParams(
      new URL(invite.url).hash.slice(1),
    ).get("invite")!;
    const guest = await register("guest", inviteToken),
      g = req(guest.token);
    assert.equal((await users.resolve(g)).actor.role, "read");
    await users.removeMember(o, {
      userId: guest.user.id,
      expectedRole: "viewer",
    });
    await assert.rejects(users.resolve(g), /접근 권한/);
    await assert.rejects(
      users.acceptInvite(g, { token: inviteToken }),
      /만료|취소/,
    );
    assert.equal((await users.profile(g)).login, "guest");
    const newSpace = await users.createWorkspace(g, { name: "복구 공간" });
    await users.switchWorkspace(g, { id: newSpace.id });
    assert.equal((await users.resolve(g)).actor.workspaceRole, "owner");
    await users.removeMember(o, {
      userId: member.user.id,
      expectedRole: "member",
    });
    await assert.rejects(users.resolve(req(oldToken.token, true)), /로그인/);
    await assert.rejects(users.resolve(m), /접근 권한/);
    await users.switchWorkspace(m, { id: another.id });
    assert.equal((await users.resolve(m)).actor.workspaceRole, "owner");
    const audit = await store.list<{ login: string; state: string }>(
      "membership",
    );
    assert.ok(
      audit.some(
        (row) => row.data.login === "member" && row.data.state === "removed",
      ),
    );
  } finally {
    await store.close();
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test("기존 조직 관리자의 권한을 한 번 이관하고 명시적 조회 역할은 보존한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cloud-pm-roles-")),
    path = join(directory, "db");
  let store = new Store(undefined, path);
  const owner = randomUUID(),
    admin = randomUUID(),
    viewer = randomUUID();
  try {
    for (const [id, login, role] of [
      [owner, "owner", "member"],
      [admin, "admin", "admin"],
      [viewer, "viewer", "admin"],
    ])
      await store.query(
        "INSERT INTO app_users(id,login,display_name,password_hash,github_cipher,github_last4,role) VALUES($1,$2,$2,'unused','unused','0000',$3)",
        [id, login, role],
      );
    await new Workspaces(store, owner).joinDefault();
    await new Workspaces(store, admin).joinDefault();
    await new Workspaces(store, viewer).joinDefault();
    await store.query(
      "UPDATE workspace_members SET role='viewer' WHERE user_id=$1",
      [viewer],
    );
    await store.query(
      "DELETE FROM app_migrations WHERE id='workspace-explicit-roles-v1'",
    );
    await store.close();
    store = new Store(undefined, path);
    assert.equal(
      (await new Workspaces(store, admin).get("main")).role,
      "admin",
    );
    assert.equal(
      (await new Workspaces(store, viewer).get("main")).role,
      "viewer",
    );
    await store.query(
      "UPDATE workspace_members SET role='member' WHERE user_id=$1",
      [admin],
    );
    await store.close();
    store = new Store(undefined, path);
    assert.equal(
      (await new Workspaces(store, admin).get("main")).role,
      "member",
    );
    assert.equal(
      (await new Workspaces(store, owner).get("main")).role,
      "owner",
    );
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
