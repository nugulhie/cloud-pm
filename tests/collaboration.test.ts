import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
import { createMcpServer } from "../src/mcp/server";

test("댓글 소유권·멘션·담당자·대화 참여자 알림과 읽음·접근 권한", async () => {
  const store = new Store();
  const actor = (login: string, role: "read" | "write" = "write") => ({
    name: login,
    userId: login,
    role,
    repositories: ["org/repo"],
  });
  const alice = new Service(store, actor("alice")),
    bob = new Service(store, actor("bob")),
    carol = new Service(store, actor("carol"));
  try {
    for (const login of ["alice", "bob", "carol", "outsider"])
      await store.query(
        "INSERT INTO app_users(id,login,display_name,password_hash,github_cipher,github_last4,repositories) VALUES($1,$1,$1,'unused','unused','0000',$2::jsonb)",
        [login, JSON.stringify(login === "outsider" ? [] : ["org/repo"])],
      );
    await store.query(
      "INSERT INTO workspace_settings(id,owner_id) VALUES('main','alice'),('other','alice')",
    );
    await store.query(
      "INSERT INTO workspace_members(workspace_id,user_id) SELECT 'main',id FROM app_users",
    );
    await alice.saveProject({
      id: "p",
      name: "제품",
      goal: "",
      repositories: ["org/repo"],
    });
    await alice.saveFeature({ id: "f", project: "p", name: "인증", goal: "" });
    await alice.saveTask({
      id: "t",
      project: "p",
      feature: "f",
      title: "로그인",
      assignee: "bob",
    });
    const first = (await alice.saveComment({
      task: "t",
      body: "**검토 요청** @carol",
    }))!;
    const thread = await bob.listComments("t");
    assert.equal(thread.comments.length, 1);
    assert.ok(!("recipients" in thread.comments[0]!.data));
    assert.equal(
      thread.members.some((m) => m.login === "outsider"),
      false,
    );
    assert.equal((await alice.listNotifications()).unread, 0);
    assert.equal((await bob.listNotifications()).unread, 1);
    assert.equal((await carol.listNotifications()).unread, 1);
    await assert.rejects(
      bob.saveComment({
        id: first.data.id,
        revision: first.revision,
        task: "t",
        body: "위조",
      }),
      /본인/,
    );
    await assert.rejects(
      bob.deleteComment({ id: first.data.id, revision: first.revision }),
      /본인/,
    );
    await assert.rejects(
      alice.saveComment({ task: "t", body: "@outsider 비공개" }),
      /멘션/,
    );
    await assert.rejects(
      alice.saveComment({ task: "t", body: "@unknown" }),
      /멘션/,
    );
    await assert.rejects(
      new Service(store, actor("alice", "read")).saveComment({
        task: "t",
        body: "작성",
      }),
      /수정 권한/,
    );
    await bob.readNotification({ id: first.data.id, revision: first.revision });
    assert.equal((await bob.listNotifications()).unread, 0);
    assert.equal((await carol.listNotifications()).unread, 1);
    await assert.rejects(
      alice.readNotification({ id: first.data.id, revision: first.revision }),
      /알림 접근/,
    );
    const updated = (await alice.saveComment({
      id: first.data.id,
      revision: first.revision,
      task: "t",
      body: "수정 @carol",
    }))!;
    assert.equal((await bob.listNotifications()).unread, 1);
    await bob.readNotification({
      id: updated.data.id,
      revision: first.revision,
    });
    assert.equal((await bob.listNotifications()).unread, 1);
    await assert.rejects(
      alice.saveComment({
        id: first.data.id,
        revision: first.revision,
        task: "t",
        body: "충돌",
      }),
      /변경/,
    );
    const reply = (await bob.saveComment({
      task: "t",
      body: "확인했습니다. `@unknown`\n```\n@unknown\n```",
    }))!;
    assert.equal(
      (await alice.listNotifications()).notifications[0]?.id,
      reply.data.id,
    );
    assert.equal((await bob.listNotifications()).notifications.length, 1);
    const restricted = new Service(store, {
      ...actor("carol"),
      repositories: [],
    });
    assert.equal(
      (await restricted.listNotifications()).notifications.length,
      0,
    );
    await assert.rejects(restricted.listComments("t"), /접근 권한/);
    const other = new Service(store, {
      ...actor("carol"),
      workspaceId: "other",
    });
    assert.equal((await other.listNotifications()).notifications.length, 0);
    await assert.rejects(other.listComments("t"), /접근 권한/);
    await alice.deleteComment({
      id: updated.data.id,
      revision: updated.revision,
    });
    assert.equal((await carol.listNotifications()).notifications.length, 0);
    const task = (await store.get("task", "t"))!;
    await alice.removeEntities({
      kind: "task",
      entries: [{ id: "t", revision: task.revision }],
    });
    assert.equal((await store.list("comment")).length, 0);
    assert.equal((await alice.listNotifications()).unread, 0);
  } finally {
    await store.close();
  }
});

test("MCP 댓글 작성·수정·알림 조회와 개인 인증 제한", async () => {
  const store = new Store();
  const service = new Service(store, {
    name: "planner",
    userId: "planner",
    role: "write",
  });
  const server = createMcpServer(service),
    client = new Client({ name: "collaboration-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    await service.saveProject({
      id: "p",
      name: "제품",
      goal: "",
      repositories: ["org/repo"],
    });
    await service.saveFeature({
      id: "f",
      project: "p",
      name: "기능",
      goal: "",
    });
    await service.saveTask({
      id: "t",
      project: "p",
      feature: "f",
      title: "작업",
    });
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      return JSON.parse((result.content as { text: string }[])[0]!.text);
    };
    const saved = await call("add_task_comment", {
      task: "t",
      body: "기획 검토",
    });
    await call("update_task_comment", {
      task: "t",
      id: saved.data.id,
      revision: saved.revision,
      body: "기획 검토 완료",
    });
    assert.equal(
      (await call("list_task_comments", { task: "t" })).comments[0].data.body,
      "기획 검토 완료",
    );
    assert.equal((await call("list_notifications", {})).unread, 0);
    await call("delete_task_comment", { id: saved.data.id, revision: 2 });
    assert.equal(
      (await call("list_task_comments", { task: "t" })).comments.length,
      0,
    );
    await assert.rejects(
      new Service(store, { name: "legacy", role: "write" }).saveComment({
        task: "t",
        body: "익명",
      }),
      /개인 사용자/,
    );
  } finally {
    await client.close();
    await server.close();
    await store.close();
  }
});
