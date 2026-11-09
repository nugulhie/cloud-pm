import { createHash, randomUUID } from "node:crypto";
import type { Store } from "../db/store";
import type { Actor, Stored, Task } from "./model";
import { taskToday } from "./task-date";
export type WorkAlert = {
  destination?: "summary-day" | "summary-week" | "changes" | "reviews" | "jobs";
  id: string;
  task: string;
  recipients: string[];
  author: string;
  body: string;
  title: string;
  kind: "assignment" | "unblocked" | "due" | "daily" | "weekly" | "review";
  createdAt: string;
};
type Preferences = {
  id: string;
  due: boolean;
  assignments: boolean;
  daily: boolean;
  weekly: boolean;
};
function alertId(key: string) {
  const hash = createHash("sha256").update(key).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
async function recipients(store: Store, task: Task) {
  if (task.assigneeUserId) return [task.assigneeUserId];
  if (!task.assignee) return [];
  const users = await store.query<{ id: string }>(
    "SELECT u.id FROM app_users u JOIN workspace_members m ON m.user_id=u.id WHERE m.workspace_id=$1 AND (lower(u.login)=lower($2) OR lower(u.github_login)=lower($2))",
    [store.workspaceId, task.assignee.replace(/^@/, "")],
  );
  return users.map((u) => u.id);
}
export async function publishWorkAlert(
  store: Store,
  key: string,
  value: Omit<WorkAlert, "id" | "createdAt">,
  now = new Date(),
  settingsCache?: Map<string, Preferences>,
) {
  const id = alertId(key);
  if (await store.get("work-alert", id)) return;
  const settings =
    settingsCache ??
    new Map(
      (await store.list<Preferences>("notification-settings")).map((r) => [
        r.data.id,
        r.data,
      ]),
    );
  const allowed = value.recipients.filter((user) => {
    const p = settings.get(user);
    return value.kind === "assignment"
      ? p?.assignments !== false
      : value.kind === "due"
        ? p?.due !== false
        : value.kind === "daily"
          ? p?.daily !== false
          : value.kind === "weekly"
            ? p?.weekly !== false
            : true;
  });
  if (!allowed.length) return;
  await store.save(
    "work-alert",
    id,
    {
      ...value,
      id,
      recipients: [...new Set(allowed)],
      createdAt: now.toISOString(),
    },
    "system",
  );
}
export async function taskWorkAlerts(
  store: Store,
  actor: Actor,
  previous: Stored<Task> | undefined,
  saved: Stored<Task>,
) {
  const task = saved.data;
  if (
    !previous ||
    previous.data.assignee !== task.assignee ||
    previous.data.assigneeUserId !== task.assigneeUserId
  ) {
    const users = [
      ...new Set([
        ...(await recipients(store, task)),
        ...(previous ? await recipients(store, previous.data) : []),
      ]),
    ].filter((id) => id !== actor.userId);
    await publishWorkAlert(store, `assignment:${task.id}:${saved.revision}`, {
      task: task.id,
      recipients: users,
      author: actor.name,
      kind: "assignment",
      title: task.title,
      body: `담당자가 ${task.assignee || "미지정"}으로 변경되었습니다.`,
    });
  }
  if (previous?.data.blockedReason && !task.blockedReason)
    await publishWorkAlert(store, `unblocked:${task.id}:${saved.revision}`, {
      task: task.id,
      recipients: await recipients(store, task),
      author: actor.name,
      kind: "unblocked",
      title: task.title,
      body: "등록된 차단 사유가 해제되었습니다. 작업을 확인하세요.",
    });
  if (previous?.data.status !== "done" && task.status === "done") {
    const tasks = await store.list<Task>("task"),
      byId = new Map(tasks.map((t) => [t.data.id, t.data]));
    for (const row of tasks)
      if (
        row.data.dependsOn?.includes(task.id) &&
        !["done", "canceled"].includes(row.data.status) &&
        row.data.dependsOn.every((id) => byId.get(id)?.status === "done")
      )
        await publishWorkAlert(
          store,
          `dependency:${task.id}:${saved.revision}:${row.data.id}`,
          {
            task: row.data.id,
            recipients: await recipients(store, row.data),
            author: actor.name,
            kind: "unblocked",
            title: row.data.title,
            body: "모든 선행 작업이 완료되었습니다. 등록된 별도 차단 사유도 확인하세요.",
          },
        );
  }
}
export async function workAlertTick(store: Store, now = new Date()) {
  const lease = randomUUID(),
    locked = await store.query(
      "INSERT INTO sync_leases(name,token,expires_at) VALUES('work-alert-maintenance-v1',$1,now()+interval '5 minutes') ON CONFLICT(name) DO UPDATE SET token=$1,expires_at=now()+interval '5 minutes' WHERE sync_leases.expires_at<now() RETURNING name",
      [lease],
    );
  if (!locked.length) return { skipped: true };
  try {
    const workspaces = await store.query<{ id: string }>(
        "SELECT id FROM workspace_settings",
      ),
      today = taskToday(now),
      hour = Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Seoul",
          hour: "2-digit",
          hourCycle: "h23",
        }).format(now),
      ),
      weekday = new Date(today + "T00:00:00Z").getUTCDay();
    for (const workspace of workspaces) {
      const scoped = store.forWorkspace(workspace.id),
        tasks = await scoped.list<Task>("task"),
        sent = new Set(
          (
            await scoped.query<{ id: string }>(
              "SELECT id FROM records WHERE workspace_id=$1 AND kind='work-alert' AND data->>'createdAt'>=$2",
              [workspace.id, today + "T00:00:00+09:00"],
            )
          ).map((r) => r.id),
        ),
        preferences = new Map(
          (await scoped.list<Preferences>("notification-settings")).map((r) => [
            r.data.id,
            r.data,
          ]),
        );
      for (const row of tasks) {
        const t = row.data;
        if (!t.dueDate || ["done", "canceled"].includes(t.status)) continue;
        const distance = Math.floor(
          (Date.parse(t.dueDate + "T00:00:00Z") -
            Date.parse(today + "T00:00:00Z")) /
            86400000,
        );
        if (distance > 1 || sent.has(alertId(`due:${today}:${t.id}`))) continue;
        await publishWorkAlert(
          scoped,
          `due:${today}:${t.id}`,
          {
            task: t.id,
            recipients: await recipients(scoped, t),
            author: "업무 알림",
            kind: "due",
            title: t.title,
            body:
              distance < 0
                ? `마감일 ${t.dueDate}을 지났습니다.`
                : distance === 0
                  ? "오늘 마감인 작업입니다."
                  : "내일 마감인 작업입니다.",
          },
          now,
          preferences,
        );
      }
      if (hour >= 9) {
        const members = await scoped.query<{ user_id: string }>(
          "SELECT user_id FROM workspace_members WHERE workspace_id=$1",
          [workspace.id],
        );
        for (const member of members) {
          if (!sent.has(alertId(`daily:${today}:${member.user_id}`)))
            await publishWorkAlert(
              scoped,
              `daily:${today}:${member.user_id}`,
              {
                task: "",
                recipients: [member.user_id],
                author: "PM 요약",
                kind: "daily",
                title: "오늘의 업무 요약",
                body: "현재 업무의 기한 초과·차단·미할당과 주요 일정을 확인하세요.",
              },
              now,
              preferences,
            );
          if (
            weekday === 1 &&
            !sent.has(alertId(`weekly:${today}:${member.user_id}`))
          )
            await publishWorkAlert(
              scoped,
              `weekly:${today}:${member.user_id}`,
              {
                task: "",
                recipients: [member.user_id],
                author: "PM 요약",
                kind: "weekly",
                title: "이번 주 업무 점검",
                body: "이번 주의 일정·마일스톤·릴리스와 지연된 작업을 점검하세요.",
              },
              now,
              preferences,
            );
        }
      }
    }
    return { skipped: false };
  } finally {
    await store.query(
      "DELETE FROM sync_leases WHERE name='work-alert-maintenance-v1' AND token=$1",
      [lease],
    );
  }
}
