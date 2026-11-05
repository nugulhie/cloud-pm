import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Store } from "../src/db/store";
import { Users } from "../src/users/service";
import { Service } from "../src/core/service";
import { DomainError, type Task, type Stored } from "../src/core/model";
import type { Sprint, SavedView, Capacity } from "../src/core/planning-model";
import { Planning } from "../src/core/planning";
import { scheduledDays, dayNumber } from "../src/core/resources";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server";
const conflict = (e: unknown) => e instanceof DomainError && e.status === 409;
const forbidden = (e: unknown) => e instanceof DomainError && e.status === 403;
test("계정 담당자·가용 시간·저장 보기·백로그·스프린트의 공통 서비스와 MCP", async (t) => {
  const store = new Store(),
    users = new Users(store);
  const pm = await users.register({
      login: "planning-pm",
      password: "synthetic-password-123",
      displayName: "PM",
    }),
    dev = await users.register({
      login: "developer",
      password: "synthetic-password-123",
      displayName: "개발자",
    }),
    other = await users.register({
      login: "other-dev",
      password: "synthetic-password-123",
      displayName: "다른 개발자",
    });
  await store.query(
    "UPDATE app_users SET github_id=$2,github_login='github-dev',github_org='org',github_org_verified_at=now() WHERE id=$1",
    [dev.user.id, "101"],
  );
  const actor = {
    name: pm.user.login,
    role: "write" as const,
    userId: pm.user.id,
    workspaceRole: "owner" as const,
    repositories: ["org/frontend", "org/backend"],
    githubTokenProvider: async () => "synthetic-token",
  };
  const service = new Service(store, actor),
    developer = new Service(store, {
      ...actor,
      name: dev.user.login,
      userId: dev.user.id,
      workspaceRole: "member",
    }),
    viewer = new Service(store, {
      ...actor,
      name: other.user.login,
      userId: other.user.id,
      role: "read",
      workspaceRole: "viewer",
    });
  const task = (id: string) => store.get<Task>("task", id).then((r) => r!);
  const sprint = (id: string) =>
    store.get<Sprint>("sprint", id).then((r) => r!);
  const planning = () => new Planning(store, actor);
  const planRead = async <T>(name: string, input: unknown = {}) =>
    (await service.readPlanning(name, input)) as T;
  try {
    await service.saveProject({
      id: "product",
      name: "제품",
      goal: "",
      repositories: actor.repositories,
    });
    await new Service(store, { name: "bootstrap", role: "write" }).saveProject({
      id: "private-project",
      name: "비공개",
      goal: "",
      repositories: ["private/repo"],
    });
    await t.test(
      "담당 계정 검증·GitHub 이름 매칭과 필드 생략 보존·명시적 해제",
      async () => {
        const people = await planning().people({ project: "product" });
        assert.equal(people.total, 3);
        assert.ok(
          people.items.every(
            (p) =>
              !("repositories" in p) &&
              !("password_hash" in p) &&
              !("github_cipher" in p),
          ),
        );
        await service.saveTask({
          id: "automatic",
          project: "product",
          title: "GitHub 담당자",
          assignee: "github-dev",
          startDate: "2026-11-09",
          dueDate: "2026-11-10",
          estimatedHours: 20,
          storyPoints: 5,
        });
        assert.equal(
          (await task("automatic")).data.assigneeUserId,
          dev.user.id,
        );
        await service.saveTask({
          id: "assigned",
          project: "product",
          title: "PM 지정",
          assigneeUserId: pm.user.id,
          startDate: "2026-11-09",
          dueDate: "2026-11-10",
          estimatedHours: 0,
          storyPoints: 0,
        });
        assert.equal((await task("assigned")).data.assignee, pm.user.login);
        let row = await task("automatic");
        const {
          startDate: _,
          estimatedHours: _h,
          storyPoints: _p,
          sprintId: _s,
          assigneeUserId: _u,
          ...legacy
        } = row.data;
        await service.saveTask(
          { ...legacy, title: "이전 클라이언트" },
          row.revision,
        );
        row = await task("automatic");
        assert.equal(row.data.startDate, "2026-11-09");
        assert.equal(row.data.estimatedHours, 20);
        assert.equal(row.data.assigneeUserId, dev.user.id);
        await service.saveTask(
          { ...legacy, assignee: "unknown-person" },
          row.revision,
        );
        assert.equal((await task("automatic")).data.assigneeUserId, null);
        row = await task("automatic");
        await service.saveTask(
          { ...row.data, assigneeUserId: dev.user.id },
          row.revision,
        );
        await assert.rejects(
          service.saveTask({
            id: "invalid-person",
            project: "product",
            title: "잘못된 담당자",
            assigneeUserId: randomUUID(),
          }),
          /워크스페이스 담당자/,
        );
        await assert.rejects(
          service.saveTask({
            id: "invalid-range",
            project: "product",
            title: "일정 역전",
            startDate: "2026-11-10",
            dueDate: "2026-11-09",
          }),
          /종료일/,
        );
      },
    );
    await t.test(
      "명시적 매칭표와 중복 후보 처리, 관리자·워크스페이스 격리",
      async () => {
        await service.saveTask({
          id: "imported",
          project: "product",
          title: "Asana 작업",
          assignee: "홍길동",
        });
        await service.writePlanning("assignments", {
          sourceName: "홍길동",
          userId: dev.user.id,
          revision: 0,
        });
        let rows = await planning().queryTasks({
          filters: { assigneeUserId: dev.user.id },
        });
        assert.ok(rows.items.some((t) => t.data.id === "imported"));
        await assert.rejects(
          developer.writePlanning("assignments", {
            sourceName: "다른 이름",
            userId: dev.user.id,
          }),
          forbidden,
        );
        const mapping = (await planning().assignmentList()).mappings[0]!;
        await assert.rejects(
          service.writePlanning("assignments", {
            sourceName: "홍길동",
            userId: other.user.id,
            revision: 0,
          }),
          conflict,
        );
        await service.writePlanning("assignments", {
          sourceName: "홍길동",
          userId: other.user.id,
          revision: mapping.revision,
        });
        rows = await planning().queryTasks({
          filters: { assigneeUserId: other.user.id },
        });
        assert.ok(rows.items.some((t) => t.data.id === "imported"));
        await store.query(
          "UPDATE app_users SET github_id=$2,github_login='github-dev' WHERE id=$1",
          [other.user.id, "102"],
        );
        await service.saveTask({
          id: "ambiguous",
          project: "product",
          title: "동명 GitHub 사용자",
          assignee: "github-dev",
        });
        assert.equal((await task("ambiguous")).data.assigneeUserId, undefined);
        await store.query(
          "UPDATE app_users SET github_login='other-github' WHERE id=$1",
          [other.user.id],
        );
        await assert.rejects(
          new Service(store, {
            ...actor,
            workspaceId: "isolated",
          }).readPlanning("resources", {
            from: "2026-11-09",
            to: "2026-11-10",
            project: "product",
          }),
          forbidden,
        );
      },
    );
    await t.test(
      "공수 분배·휴무 예외·초과 배정·미산정과 접근 범위",
      async () => {
        await service.saveTask({
          id: "due-only",
          project: "product",
          title: "마감일 기준",
          assigneeUserId: dev.user.id,
          dueDate: "2026-11-09",
          estimatedHours: 8,
        });
        await service.saveTask({
          id: "unplanned",
          project: "product",
          title: "공수 미정",
          assigneeUserId: dev.user.id,
          dueDate: "2026-11-09",
        });
        await service.saveTask({
          id: "completed",
          project: "product",
          title: "이미 완료",
          assigneeUserId: dev.user.id,
          dueDate: "2026-11-09",
          estimatedHours: 100,
          status: "done",
        });
        await new Service(store, { name: "bootstrap", role: "write" }).saveTask(
          {
            id: "private-task",
            project: "private-project",
            title: "노출 금지",
            assignee: "github-dev",
            dueDate: "2026-11-09",
            estimatedHours: 1000,
          },
        );
        let plan = await planning().resources({
            project: "product",
            from: "2026-11-09",
            to: "2026-11-10",
          }),
          row = plan.people.items.find((p) => p.person.id === dev.user.id)!;
        assert.deepEqual(
          row.cells.map((c) => c.planned),
          [18, 10],
        );
        assert.ok(row.cells.every((c) => c.overloaded));
        assert.equal(row.unplannedCount, 2);
        assert.deepEqual(row.unplanned.map((t) => t.id).sort(), [
          "ambiguous",
          "unplanned",
        ]);
        assert.ok(row.tasks.find((t) => t.id === "due-only")!.inferredStart);
        assert.ok(!row.tasks.some((t) => t.id === "completed"));
        await service.writePlanning("capacity", {
          userId: dev.user.id,
          hoursPerDay: 8,
          weekdays: [1, 2, 3, 4, 5],
          exceptions: { "2026-11-10": 0 },
          revision: 0,
        });
        plan = await planning().resources({
          project: "product",
          from: "2026-11-09",
          to: "2026-11-10",
        });
        row = plan.people.items.find((p) => p.person.id === dev.user.id)!;
        assert.deepEqual(
          row.cells.map((c) => c.planned),
          [28, 0],
        );
        assert.equal(row.cells[1]!.capacity, 0);
        await assert.rejects(
          developer.writePlanning("capacity", { userId: pm.user.id }),
          forbidden,
        );
        await assert.rejects(
          service.readPlanning("resources", {
            from: "2026-11-01",
            to: "2027-03-01",
          }),
          /93일/,
        );
        const visible = await planning().resources({
          from: "2026-11-09",
          to: "2026-11-10",
        });
        assert.ok(!JSON.stringify(visible).includes("노출 금지"));
        const capacity = (await store.get<Capacity>(
          "member-capacity",
          dev.user.id,
        ))!;
        const race = await Promise.allSettled(
          [7, 6].map((hoursPerDay) =>
            service.writePlanning("capacity", {
              userId: dev.user.id,
              hoursPerDay,
              revision: capacity.revision,
            }),
          ),
        );
        assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(
          race.filter((r) => r.status === "rejected" && conflict(r.reason))
            .length,
          1,
        );
      },
    );
    await t.test(
      "개인 보기·공유 보기의 소유권·내 작업 상대 해석·수정 충돌",
      async () => {
        await service.writePlanning("views", {
          id: "private-view",
          name: "PM 개인",
          visibility: "private",
          filters: { assigneeUserId: "me" },
          revision: 0,
        });
        await service.writePlanning("views", {
          id: "shared-view",
          name: "공유 내 작업",
          visibility: "workspace",
          filters: {
            project: "product",
            assigneeUserId: "me",
            priorities: ["medium"],
          },
          revision: 0,
        });
        const developerViews = (await developer.readPlanning(
          "views",
        )) as Stored<SavedView>[];
        assert.deepEqual(
          developerViews.map((v) => v.data.id),
          ["shared-view"],
        );
        await assert.rejects(
          developer.writePlanning("views", {
            id: "private-view",
            name: "탈취",
            visibility: "private",
            filters: {},
            revision: 1,
          }),
          forbidden,
        );
        await assert.rejects(
          developer.writePlanning("views/delete", {
            id: "shared-view",
            revision: 1,
          }),
          forbidden,
        );
        await assert.rejects(
          service.writePlanning("views", {
            id: "shared-view",
            name: "오래된 값",
            visibility: "workspace",
            filters: {},
            revision: 0,
          }),
          conflict,
        );
        const mine = await new Planning(store, {
            ...actor,
            userId: pm.user.id,
          }).queryTasks({ filters: { assigneeUserId: "me" } }),
          theirs = await new Planning(store, {
            ...actor,
            userId: dev.user.id,
          }).queryTasks({ filters: { assigneeUserId: "me" } });
        assert.ok(mine.items.every((t) => t.assignedUser?.id === pm.user.id));
        assert.ok(
          theirs.items.every((t) => t.assignedUser?.id === dev.user.id),
        );
        assert.notEqual(mine.total, theirs.total);
        await assert.rejects(
          service.writePlanning("views", {
            id: "hidden-view",
            name: "접근 불가",
            visibility: "workspace",
            filters: { project: "private-project" },
          }),
          forbidden,
        );
        await assert.rejects(
          viewer.writePlanning("views", {
            id: "viewer-write",
            name: "금지",
            visibility: "workspace",
            filters: {},
          }),
          forbidden,
        );
      },
    );
    await t.test(
      "스프린트 시작은 프로젝트당 하나, 종료 집계 보존과 미완료 이동은 원자적",
      async () => {
        for (const id of ["sprint-1", "sprint-2"])
          await service.writePlanning("sprints", {
            id,
            project: "product",
            name: id,
            goal: "출시",
            startDate: "2026-11-09",
            endDate: "2026-11-20",
          });
        await service.saveTask({
          id: "sprint-done",
          project: "product",
          title: "완료",
          assigneeUserId: dev.user.id,
          status: "done",
          estimatedHours: 3,
          storyPoints: 5,
          sprintId: "sprint-1",
        });
        await service.saveTask({
          id: "sprint-canceled",
          project: "product",
          title: "취소",
          status: "canceled",
          estimatedHours: 100,
          sprintId: "sprint-1",
        });
        await service.saveTask({
          id: "sprint-open",
          project: "product",
          title: "진행",
          status: "in_progress",
          description: "보존할 본문",
          yaml: "",
          sprintId: "sprint-1",
        });
        const starts = await Promise.allSettled(
          ["sprint-1", "sprint-2"].map((id) =>
            service.writePlanning("sprints/start", { id, revision: 1 }),
          ),
        );
        assert.equal(starts.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(
          starts.filter((r) => r.status === "rejected" && conflict(r.reason))
            .length,
          1,
        );
        // 병렬 실행에서 먼저 시작한 스프린트가 2번이면 종료 후 1번을 시작한다.
        if ((await sprint("sprint-2")).data.status === "active") {
          await service.writePlanning("sprints/close", {
            id: "sprint-2",
            revision: (await sprint("sprint-2")).revision,
          });
          await service.writePlanning("sprints/start", {
            id: "sprint-1",
            revision: 1,
          });
          await service.writePlanning("sprints", {
            id: "next-sprint",
            project: "product",
            name: "다음",
            startDate: "2026-11-23",
            endDate: "2026-12-04",
          });
        }
        const next =
          (await sprint("sprint-2")).data.status === "planned"
            ? "sprint-2"
            : "next-sprint";
        await assert.rejects(
          service.writePlanning("sprints/delete", {
            id: "sprint-1",
            revision: (await sprint("sprint-1")).revision,
          }),
          /계획/,
        );
        await service.writePlanning("sprints/close", {
          id: "sprint-1",
          revision: (await sprint("sprint-1")).revision,
          moveTo: next,
        });
        const closed = await sprint("sprint-1");
        assert.equal(closed.data.status, "closed");
        assert.deepEqual(closed.data.closure, {
          done: ["sprint-done"],
          canceled: ["sprint-canceled"],
          incomplete: ["sprint-open"],
          estimatedHours: 3,
          storyPoints: 5,
        });
        assert.equal((await task("sprint-open")).data.sprintId, next);
        assert.equal(
          (await task("sprint-open")).data.description,
          "보존할 본문",
        );
        let done = await task("sprint-done");
        await service.saveTask(
          { ...done.data, status: "ready" },
          done.revision,
        );
        assert.ok(
          (await planning().backlog({ project: "product" })).items.some(
            (t) => t.data.id === "sprint-done",
          ),
        );
        assert.deepEqual(
          (await sprint("sprint-1")).data.closure,
          closed.data.closure,
        );
        await assert.rejects(
          service.saveTask({
            id: "bad-closed",
            project: "product",
            title: "종료 후 추가",
            sprintId: "sprint-1",
          }),
          /스프린트/,
        );
        await service.writePlanning("sprints/delete", {
          id: next,
          revision: (await sprint(next)).revision,
        });
        assert.equal((await task("sprint-open")).data.sprintId, null);
      },
    );
    await t.test(
      "스프린트 배정은 태스크별 revision·프로젝트를 확인하고 일부만 저장하지 않는다",
      async () => {
        await service.writePlanning("sprints", {
          id: "bulk-sprint",
          project: "product",
          name: "일괄",
          startDate: "2026-12-01",
          endDate: "2026-12-14",
        });
        const first = await task("assigned"),
          second = await task("automatic");
        await assert.rejects(
          service.writePlanning("sprints/assign", {
            project: "product",
            sprintId: "bulk-sprint",
            entries: [
              { id: first.data.id, revision: first.revision },
              { id: second.data.id, revision: second.revision + 1 },
            ],
          }),
          conflict,
        );
        assert.equal((await task("assigned")).data.sprintId, undefined);
        await service.writePlanning("sprints/assign", {
          project: "product",
          sprintId: "bulk-sprint",
          entries: [
            { id: first.data.id, revision: first.revision },
            { id: second.data.id, revision: second.revision },
          ],
        });
        assert.equal((await task("assigned")).data.sprintId, "bulk-sprint");
      },
    );
    await t.test(
      "백로그 순서는 페이지 밖 태스크를 보존하고 선행 대기 필터는 완료를 반영한다",
      async () => {
        for (let i = 0; i < 55; i++)
          await service.saveTask({
            id: `order-${String(i).padStart(2, "0")}`,
            project: "product",
            title: `작업 ${i}`,
          });
        const before = await planning().backlog({
          project: "product",
          limit: 100,
        });
        await service.writePlanning("backlog/reorder", {
          project: "product",
          taskId: "order-54",
          beforeTaskId: "order-00",
          revision: before.revision,
        });
        const after = await planning().backlog({
          project: "product",
          limit: 100,
        });
        assert.equal(after.total, before.total);
        const expectedOrder = before.items
          .map((t) => t.data.id)
          .filter((id) => id !== "order-54");
        expectedOrder.splice(expectedOrder.indexOf("order-00"), 0, "order-54");
        assert.deepEqual(
          after.items.map((t) => t.data.id),
          expectedOrder,
        );
        assert.equal(
          new Set(after.items.map((t) => t.data.id)).size,
          after.total,
        );
        assert.equal(
          after.items.findIndex((t) => t.data.id === "order-54") + 1,
          after.items.findIndex((t) => t.data.id === "order-00"),
        );
        await assert.rejects(
          service.writePlanning("backlog/reorder", {
            project: "product",
            taskId: "order-01",
            beforeTaskId: null,
            revision: before.revision,
          }),
          conflict,
        );
        await service.saveTask({
          id: "dependency-task",
          project: "product",
          title: "선행 대기",
          dependsOn: ["order-00"],
        });
        assert.ok(
          (
            await planning().queryTasks({
              filters: { blockedOnly: true },
              limit: 100,
            })
          ).items.some((t) => t.data.id === "dependency-task"),
        );
        const prerequisite = await task("order-00");
        await service.saveTask(
          { ...prerequisite.data, status: "done" },
          prerequisite.revision,
        );
        assert.ok(
          !(
            await planning().queryTasks({
              filters: { blockedOnly: true },
              limit: 100,
            })
          ).items.some((t) => t.data.id === "dependency-task"),
        );
      },
    );
    await t.test(
      "MCP에서 계획 도구를 실제 호출하고 조회 역할에는 쓰기 도구를 노출하지 않는다",
      async () => {
        for (const target of [service, viewer]) {
          const server = createMcpServer(target),
            client = new Client({ name: "planning-test", version: "1" }),
            [a, b] = InMemoryTransport.createLinkedPair();
          await server.connect(b);
          await client.connect(a);
          try {
            const tools = await client.listTools();
            assert.ok(tools.tools.some((t) => t.name === "get_resource_plan"));
            assert.equal(
              tools.tools.some((t) => t.name === "save_sprint"),
              target.actor.role === "write",
            );
            const result = await client.callTool({
              name: "get_resource_plan",
              arguments: {
                project: "product",
                from: "2026-11-09",
                to: "2026-11-10",
              },
            });
            assert.notEqual(result.isError, true);
          } finally {
            await client.close();
            await server.close();
          }
        }
      },
    );
    await t.test(
      "프로젝트 삭제는 스프린트·정렬·프로젝트 보기만 정리하고 전역 보기·가용 시간은 보존한다",
      async () => {
        const project = (await store.get("project", "product"))!;
        await service.removeEntities({
          kind: "project",
          entries: [{ id: "product", revision: project.revision }],
        });
        assert.equal(
          (await store.list<Sprint>("sprint")).some(
            (s) => s.data.project === "product",
          ),
          false,
        );
        assert.equal(await store.get("backlog-order", "product"), undefined);
        assert.equal(
          (await store.list<SavedView>("saved-view")).some(
            (v) => v.data.filters.project === "product",
          ),
          false,
        );
        assert.ok(await store.get("saved-view", "private-view"));
        assert.ok(await store.get("member-capacity", dev.user.id));
        assert.equal(
          (await store.list<Task>("task")).some(
            (t) => t.data.project === "product",
          ),
          false,
        );
        assert.ok(await store.get("task", "private-task"));
      },
    );
  } finally {
    await store.close();
  }
});

test("장기간 공수 계산은 주 단위로 계산하며 근무일 예외와 0시간을 반영한다", () => {
  const capacity: Capacity = {
    userId: randomUUID(),
    hoursPerDay: 8,
    weekdays: [1, 2, 3, 4, 5],
    exceptions: { "2026-11-10": 0, "2026-11-14": 4 },
  };
  assert.equal(
    scheduledDays(dayNumber("2026-11-09"), dayNumber("2026-11-15"), capacity),
    5,
  );
  assert.equal(
    scheduledDays(dayNumber("2026-11-09"), dayNumber("2026-11-15"), {
      ...capacity,
      hoursPerDay: 0,
    }),
    1,
  );
  assert.ok(
    scheduledDays(dayNumber("1900-01-01"), dayNumber("2100-12-31"), capacity) >
      50000,
  );
});
