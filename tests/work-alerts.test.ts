import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/db/store";
import { Users } from "../src/users/service";
import { Service } from "../src/core/service";
import { workAlertTick } from "../src/core/work-alerts";
test("업무 알림과 일일·주간 요약은 날짜별로 중복되지 않고 개인 설정과 조회 권한을 적용한다", async () => {
  const old = process.env.DEMO_MODE;
  delete process.env.DEMO_MODE;
  const store = new Store();
  try {
    const users = new Users(store),
      pm = await users.register({
        login: "pm-user",
        displayName: "PM",
        password: "long-test-password",
      }),
      dev = await users.register({
        login: "developer",
        displayName: "개발자",
        password: "long-test-password",
      });
    const service = new Service(store, {
        name: "pm-user",
        role: "write",
        userId: pm.user.id,
        workspaceRole: "owner",
      }),
      reader = new Service(store, {
        name: "developer",
        role: "write",
        userId: dev.user.id,
        workspaceRole: "member",
      });
    await service.saveProject({
      id: "p",
      name: "P",
      goal: "",
      repositories: [],
    });
    await service.saveTask({
      id: "t",
      project: "p",
      title: "기한 작업",
      assigneeUserId: dev.user.id,
      dueDate: "2026-11-08",
    });
    const now = new Date("2026-11-09T00:10:00Z");
    await workAlertTick(store, now);
    const first = await reader.listNotifications();
    assert.ok(first.notifications.some((n) => n.body.includes("지났습니다")));
    assert.ok(first.notifications.some((n) => n.title.includes("이번 주")));
    await workAlertTick(store, now);
    assert.equal(
      (await reader.listNotifications()).notifications.length,
      first.notifications.length,
    );
    await reader.writeWorkflow("notification-settings", {
      revision: 0,
      due: false,
      daily: false,
      weekly: false,
      assignments: false,
    });
    await workAlertTick(store, new Date("2026-11-10T00:10:00Z"));
    assert.equal(
      (await reader.listNotifications()).notifications.length,
      first.notifications.length,
    );
    const denied = new Service(store.forWorkspace("other"), {
      name: "developer",
      role: "read",
      workspaceId: "other",
      userId: dev.user.id,
    });
    assert.equal((await denied.listNotifications()).notifications.length, 0);
  } finally {
    await store.close();
    if (old === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = old;
  }
});
