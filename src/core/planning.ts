import { createHash } from "node:crypto";
import { z } from "zod";
import type { Store } from "../db/store";
import {
  id,
  DomainError,
  type Actor,
  type Project,
  type Task,
  type Stored,
} from "./model";
import { requireWrite, demoMode } from "./auth";
import {
  taskFilters,
  savedViewInput,
  capacityInput,
  sprintInput,
  assignmentInput,
  normalizedAssignee,
  planningPage,
  type SavedView,
  type Capacity,
  type Sprint,
  type Assignment,
  type PlanningPerson,
  type TaskFilters,
} from "./planning-model";
import { dayNumber, dayString, scheduledDays, capacityAt } from "./resources";
type Member = PlanningPerson & {
  repositories: string[];
  shared_repositories: string[] | null;
};
const page = <T>(items: T[], offset: number, limit: number) => ({
  items: items.slice(offset, offset + limit),
  total: items.length,
  offset,
  limit,
  hasMore: offset + limit < items.length,
  nextOffset: offset + limit < items.length ? offset + limit : null,
});
const active = (t: Task) => !["done", "canceled"].includes(t.status);
const checkRevision = (old: Stored<unknown> | undefined, revision: number) => {
  if ((old?.revision ?? 0) !== revision)
    throw new DomainError(
      "다른 요청이 변경했습니다. 새로고침 후 다시 시도하세요.",
      409,
    );
};
export class Planning {
  private membersCache?: Promise<Member[]>;
  private aliasesCache?: Promise<Stored<Assignment>[]>;
  private projectsCache?: Promise<Stored<Project>[]>;
  private eligibleMembersCache = new Map<string, Member[]>();
  constructor(
    private store: Store,
    private actor: Actor,
    private writeTask?: (task: Task, revision: number) => Promise<unknown>,
  ) {}
  private admin() {
    return (
      ["owner", "admin"].includes(this.actor.workspaceRole ?? "") ||
      (!this.actor.userId && demoMode())
    );
  }
  private identity() {
    if (!this.actor.userId)
      throw new DomainError("개인 계정 로그인이 필요합니다.", 401);
    return this.actor.userId;
  }
  private async members() {
    return (this.membersCache ??= this.store.query<Member>(
      'SELECT u.id,u.login,u.display_name AS "displayName",u.github_login AS "githubLogin",u.github_id AS "githubId",m.role,u.repositories,g.repositories AS shared_repositories FROM app_users u JOIN workspace_members m ON m.user_id=u.id LEFT JOIN workspace_github g ON g.workspace_id=m.workspace_id WHERE m.workspace_id=$1 ORDER BY u.login,u.id',
      [this.store.workspaceId],
    ));
  }
  private publicMember(m: Member): PlanningPerson {
    const { repositories: _r, shared_repositories: _s, ...person } = m;
    return person;
  }
  private visible(p: Project) {
    return (
      !this.actor.repositories ||
      p.repositories.every((r) =>
        this.actor.repositories!.includes(r.toLowerCase()),
      )
    );
  }
  private projects() {
    return (this.projectsCache ??= this.store.list<Project>("project"));
  }
  async project(project: string) {
    const row = (await this.projects()).find((p) => p.data.id === project);
    if (!row || !this.visible(row.data))
      throw new DomainError("프로젝트 접근 권한이 없습니다.", 403);
    return row;
  }
  private memberAccess(member: Member, p: Project) {
    const repos = new Set(
      [
        ...member.repositories,
        ...(this.actor.githubTokenProvider
          ? (this.actor.repositories ?? [])
          : (member.shared_repositories ?? [])),
      ].map((r) => r.toLowerCase()),
    );
    return p.repositories.every((r) => repos.has(r.toLowerCase()));
  }
  async people(input: unknown = {}) {
    const data = z
        .object({ project: id.optional(), ...planningPage })
        .parse(input),
      project = data.project ? (await this.project(data.project)).data : null;
    const members = (await this.members()).filter(
      (m) => !project || this.memberAccess(m, project),
    );
    return page(
      members.map((m) => this.publicMember(m)),
      data.offset,
      data.limit,
    );
  }
  private async assignments() {
    return (this.aliasesCache ??=
      this.store.list<Assignment>("assignee-mapping"));
  }
  private async match(
    task: Task,
    members: Member[],
    aliases: Stored<Assignment>[],
  ) {
    const project = (await this.projects()).find(
      (p) => p.data.id === task.project,
    )?.data;
    if (!project) return null;
    let eligible = this.eligibleMembersCache.get(project.id);
    if (!eligible) {
      eligible = members.filter((m) => this.memberAccess(m, project));
      this.eligibleMembersCache.set(project.id, eligible);
    }
    if (task.assigneeUserId)
      return eligible.find((m) => m.id === task.assigneeUserId) ?? null;
    const name = normalizedAssignee(task.assignee);
    if (!name) return null;
    const alias = aliases.find(
      (a) => normalizedAssignee(a.data.sourceName) === name,
    );
    if (alias) return eligible.find((m) => m.id === alias.data.userId) ?? null;
    const candidates = eligible.filter(
      (m) =>
        normalizedAssignee(m.login) === name ||
        (m.githubId && normalizedAssignee(m.githubLogin ?? "") === name),
    );
    return candidates.length === 1 ? candidates[0]! : null;
  }
  async assignmentIds(tasks: Task[]) {
    const [members, aliases] = await Promise.all([
      this.members(),
      this.assignments(),
    ]);
    const ids: Record<string, string | null> = {};
    for (const task of tasks)
      ids[task.id] = (await this.match(task, members, aliases))?.id ?? null;
    return ids;
  }
  async normalizeTask(task: Task, old?: Task) {
    for (const field of [
      "startDate",
      "estimatedHours",
      "storyPoints",
      "sprintId",
    ] as const)
      if (task[field] === undefined && old?.[field] !== undefined)
        (task as Record<string, unknown>)[field] = old[field];
    if (task.startDate && task.dueDate && task.startDate > task.dueDate)
      throw new DomainError("태스크 종료일은 시작일 이후여야 합니다.");
    const explicit = task.assigneeUserId !== undefined;
    if (!explicit)
      task.assigneeUserId =
        old?.assignee === task.assignee
          ? old.assigneeUserId
          : old?.assigneeUserId
            ? null
            : undefined;
    if (task.assigneeUserId) {
      const member = (await this.members()).find(
        (m) => m.id === task.assigneeUserId,
      );
      const allowed =
        member &&
        this.memberAccess(member, (await this.project(task.project)).data);
      if (!allowed && task.assigneeUserId !== old?.assigneeUserId)
        throw new DomainError(
          "이 프로젝트에 참여하는 워크스페이스 담당자를 선택하세요.",
        );
      if (allowed) task.assignee = member!.githubLogin ?? member!.login;
    } else if (
      !explicit &&
      (!old || old.assignee !== task.assignee) &&
      task.assignee
    ) {
      const member = await this.match(
        task,
        await this.members(),
        await this.assignments(),
      );
      task.assigneeUserId =
        member?.id ?? (old?.assigneeUserId ? null : undefined);
    }
    if (task.sprintId) {
      const sprint = await this.store.get<Sprint>("sprint", task.sprintId);
      if (
        !sprint ||
        sprint.data.project !== task.project ||
        (sprint.data.status === "closed" && old?.sprintId !== task.sprintId)
      )
        throw new DomainError(
          "같은 프로젝트의 계획 또는 진행 중인 스프린트를 선택하세요.",
        );
    }
  }
  async assignmentList() {
    const members = await this.members();
    return {
      mappings: await this.assignments(),
      members: members.map((m) => this.publicMember(m)),
      canManage: this.admin(),
    };
  }
  async saveAssignment(input: unknown) {
    requireWrite(this.actor);
    if (!this.admin())
      throw new DomainError(
        "워크스페이스 관리자만 담당자 매칭표를 변경할 수 있습니다.",
        403,
      );
    const { revision, ...value } = assignmentInput.parse(input);
    if (!(await this.members()).some((m) => m.id === value.userId))
      throw new DomainError("워크스페이스 구성원을 선택하세요.");
    const key =
        "assignee-" +
        createHash("sha256")
          .update(normalizedAssignee(value.sourceName))
          .digest("hex")
          .slice(0, 40),
      old = await this.store.get<Assignment>("assignee-mapping", key);
    checkRevision(old, revision);
    return this.store.save(
      "assignee-mapping",
      key,
      { id: key, ...value },
      this.actor.name,
      old?.revision,
    );
  }
  async deleteAssignment(input: unknown) {
    requireWrite(this.actor);
    if (!this.admin())
      throw new DomainError(
        "워크스페이스 관리자만 담당자 매칭표를 변경할 수 있습니다.",
        403,
      );
    const value = z
        .strictObject({ id, revision: z.number().int().positive() })
        .parse(input),
      old = await this.store.get("assignee-mapping", value.id);
    checkRevision(old, value.revision);
    await this.store.removeMany(
      [{ kind: "assignee-mapping", ...value }],
      this.actor.name,
    );
    return { removed: 1 };
  }
  async saveCapacity(input: unknown) {
    requireWrite(this.actor);
    const { revision, ...value } = capacityInput.parse(input);
    if (!this.admin() && this.actor.userId !== value.userId)
      throw new DomainError(
        "다른 구성원의 가용 시간은 관리자만 수정할 수 있습니다.",
        403,
      );
    if (!(await this.members()).some((m) => m.id === value.userId))
      throw new DomainError("워크스페이스 구성원을 선택하세요.");
    value.weekdays = [...new Set(value.weekdays)];
    const old = await this.store.get("member-capacity", value.userId);
    checkRevision(old, revision);
    return this.store.save(
      "member-capacity",
      value.userId,
      value,
      this.actor.name,
      old?.revision,
    );
  }
  async views() {
    const owner = this.identity(),
      projects = new Set(
        (await this.store.list<Project>("project"))
          .filter((p) => this.visible(p.data))
          .map((p) => p.data.id),
      );
    return (await this.store.list<SavedView>("saved-view")).filter(
      (v) =>
        (v.data.visibility === "workspace" || v.data.ownerId === owner) &&
        (!v.data.filters.project || projects.has(v.data.filters.project)),
    );
  }
  async saveView(input: unknown) {
    requireWrite(this.actor);
    const owner = this.identity(),
      { revision, ...value } = savedViewInput.parse(input),
      old = await this.store.get<SavedView>("saved-view", value.id);
    if (
      old &&
      old.data.ownerId !== owner &&
      !(old.data.visibility === "workspace" && this.admin())
    )
      throw new DomainError("이 보기를 수정할 권한이 없습니다.", 403);
    if (old?.data.filters.project) await this.project(old.data.filters.project);
    if (value.filters.project) await this.project(value.filters.project);
    checkRevision(old, revision);
    return this.store.save(
      "saved-view",
      value.id,
      { ...value, ownerId: old?.data.ownerId ?? owner },
      this.actor.name,
      old?.revision,
    );
  }
  async deleteView(input: unknown) {
    requireWrite(this.actor);
    const owner = this.identity(),
      value = z
        .strictObject({ id, revision: z.number().int().positive() })
        .parse(input),
      old = await this.store.get<SavedView>("saved-view", value.id);
    if (
      !old ||
      (old.data.ownerId !== owner &&
        !(old.data.visibility === "workspace" && this.admin()))
    )
      throw new DomainError("이 보기를 삭제할 권한이 없습니다.", 403);
    if (old.data.filters.project) await this.project(old.data.filters.project);
    checkRevision(old, value.revision);
    await this.store.removeMany(
      [{ kind: "saved-view", ...value }],
      this.actor.name,
    );
    return { removed: 1 };
  }
  async tasks(filters: TaskFilters = {}) {
    const projects = (await this.store.list<Project>("project")).filter((p) =>
      this.visible(p.data),
    );
    if (filters.project) await this.project(filters.project);
    const allowed = new Set(
      projects
        .filter((p) => !filters.project || p.data.id === filters.project)
        .map((p) => p.data.id),
    );
    const rows = await this.store.query<{
      data: Task;
      revision: number;
      updated_at: string;
    }>(
      "SELECT data-'description'-'yaml' AS data,revision,updated_at FROM records WHERE workspace_id=$1 AND kind='task' AND NOT(data ? '_deleted') ORDER BY id",
      [this.store.workspaceId],
    );
    const [members, aliases, sprints] = await Promise.all([
      this.members(),
      this.assignments(),
      this.store.list<Sprint>("sprint"),
    ]);
    const matches = [];
    const taskIndex = new Map(rows.map((r) => [r.data.id, r.data]));
    for (const row of rows) {
      const t = row.data;
      if (!allowed.has(t.project)) continue;
      const assigned = await this.match(t, members, aliases),
        sprint = t.sprintId
          ? sprints.find((s) => s.data.id === t.sprintId)?.data
          : null;
      if (
        (filters.assigneeUserId === "me" && assigned?.id !== this.identity()) ||
        (filters.assigneeUserId === "unassigned" && assigned) ||
        (filters.assigneeUserId &&
          !["me", "unassigned"].includes(filters.assigneeUserId) &&
          assigned?.id !== filters.assigneeUserId)
      )
        continue;
      if (
        (filters.assignee &&
          normalizedAssignee(t.assignee) !==
            normalizedAssignee(filters.assignee)) ||
        (filters.statuses?.length && !filters.statuses.includes(t.status)) ||
        (filters.types?.length &&
          !filters.types.includes(t.type ?? "feature")) ||
        (filters.priorities?.length &&
          !filters.priorities.includes(t.priority)) ||
        (filters.query &&
          !`${t.title} ${t.assignee}`
            .toLowerCase()
            .includes(filters.query.toLowerCase())) ||
        (filters.blockedOnly &&
          (!active(t) ||
            !t.dependsOn?.some((id) => {
              const prerequisite = taskIndex.get(id);
              return (
                prerequisite?.project !== t.project ||
                prerequisite.status !== "done"
              );
            }))) ||
        (filters.dueBefore && (!t.dueDate || t.dueDate > filters.dueBefore)) ||
        (filters.dueAfter && (!t.dueDate || t.dueDate < filters.dueAfter))
      )
        continue;
      if (
        (filters.sprintId === "backlog" &&
          (!active(t) || (t.sprintId && sprint?.status !== "closed"))) ||
        (filters.sprintId &&
          filters.sprintId !== "backlog" &&
          t.sprintId !== filters.sprintId)
      )
        continue;
      matches.push({
        data: t,
        revision: row.revision,
        updatedAt: new Date(row.updated_at).toISOString(),
        assignedUser: assigned ? this.publicMember(assigned) : null,
      });
    }
    return matches;
  }
  async sprintStates(projectIds: Set<string>) {
    const rows = await this.store.query<{
      id: string;
      project: string;
      status: string;
    }>(
      "SELECT id,data->>'project' AS project,data->>'status' AS status FROM records WHERE workspace_id=$1 AND kind='sprint' AND NOT(data ? '_deleted')",
      [this.store.workspaceId],
    );
    return Object.fromEntries(
      rows
        .filter((r) => projectIds.has(r.project))
        .map((r) => [r.id, r.status]),
    );
  }
  async queryTasks(input: unknown) {
    const value = z
      .strictObject({ filters: taskFilters.default({}), ...planningPage })
      .parse(input);
    return page(await this.tasks(value.filters), value.offset, value.limit);
  }
  async sprintList(input: unknown = {}) {
    const value = z.object({ project: id.optional() }).parse(input),
      allowed = new Set(
        (await this.store.list<Project>("project"))
          .filter((p) => this.visible(p.data))
          .map((p) => p.data.id),
      );
    if (value.project) await this.project(value.project);
    return (await this.store.list<Sprint>("sprint"))
      .filter(
        (s) =>
          allowed.has(s.data.project) &&
          (!value.project || s.data.project === value.project),
      )
      .sort((a, b) => a.data.startDate.localeCompare(b.data.startDate));
  }
  async saveSprint(input: unknown) {
    requireWrite(this.actor);
    const { revision, ...value } = sprintInput.parse(input);
    await this.project(value.project);
    if (value.startDate > value.endDate)
      throw new DomainError("스프린트 종료일은 시작일 이후여야 합니다.");
    const old = await this.store.get<Sprint>("sprint", value.id);
    if (old) {
      await this.project(old.data.project);
      if (old.data.project !== value.project || old.data.status === "closed")
        throw new DomainError(
          "종료 스프린트 또는 프로젝트는 변경할 수 없습니다.",
        );
    }
    checkRevision(old, revision);
    return this.store.save(
      "sprint",
      value.id,
      { ...old?.data, ...value, status: old?.data.status ?? "planned" },
      this.actor.name,
      old?.revision,
    );
  }
  private async sprint(input: unknown) {
    const value = z
        .object({ id, revision: z.number().int().positive() })
        .parse(input),
      row = await this.store.get<Sprint>("sprint", value.id);
    if (!row) throw new DomainError("스프린트가 없습니다.", 404);
    await this.project(row.data.project);
    checkRevision(row, value.revision);
    return row;
  }
  async startSprint(input: unknown) {
    requireWrite(this.actor);
    const row = await this.sprint(input);
    if (row.data.status !== "planned")
      throw new DomainError("계획 스프린트만 시작할 수 있습니다.", 409);
    if (
      (await this.store.list<Sprint>("sprint")).some(
        (s) =>
          s.data.project === row.data.project && s.data.status === "active",
      )
    )
      throw new DomainError("이미 진행 중인 스프린트가 있습니다.", 409);
    const tasks = await this.tasks({
      project: row.data.project,
      sprintId: row.data.id,
    });
    return this.store.save(
      "sprint",
      row.data.id,
      {
        ...row.data,
        status: "active",
        startedAt: new Date().toISOString(),
        initialTaskIds: tasks.map((t) => t.data.id),
      },
      this.actor.name,
      row.revision,
    );
  }
  private async changeTask(row: Stored<Task>, sprintId: string | null) {
    if (!this.writeTask) throw new Error("Task writer required");
    await this.writeTask({ ...row.data, sprintId }, row.revision);
  }
  async assignSprint(input: unknown) {
    requireWrite(this.actor);
    const value = z
      .strictObject({
        project: id,
        sprintId: id.nullable(),
        entries: z
          .array(z.strictObject({ id, revision: z.number().int().positive() }))
          .min(1)
          .max(100),
      })
      .parse(input);
    await this.project(value.project);
    if (new Set(value.entries.map((t) => t.id)).size !== value.entries.length)
      throw new DomainError("중복 태스크를 확인하세요.");
    for (const entry of value.entries) {
      const task = await this.store.get<Task>("task", entry.id);
      if (!task || task.data.project !== value.project)
        throw new DomainError("같은 프로젝트의 태스크를 선택하세요.");
      checkRevision(task, entry.revision);
      await this.changeTask(task, value.sprintId);
    }
    return { updated: value.entries.length };
  }
  async closeSprint(input: unknown) {
    requireWrite(this.actor);
    const value = z
        .strictObject({
          id,
          revision: z.number().int().positive(),
          moveTo: id.nullable().default(null),
        })
        .parse(input),
      row = await this.sprint(value);
    if (row.data.status !== "active")
      throw new DomainError("진행 중인 스프린트만 종료할 수 있습니다.", 409);
    if (value.moveTo) {
      const next = await this.store.get<Sprint>("sprint", value.moveTo);
      if (
        !next ||
        next.data.project !== row.data.project ||
        next.data.status !== "planned" ||
        next.data.id === row.data.id
      )
        throw new DomainError(
          "같은 프로젝트의 다음 계획 스프린트를 선택하세요.",
        );
    }
    const tasks = await this.tasks({
        project: row.data.project,
        sprintId: row.data.id,
      }),
      done = tasks.filter((t) => t.data.status === "done"),
      incomplete = tasks.filter((t) => active(t.data));
    const result = await this.store.save(
      "sprint",
      row.data.id,
      {
        ...row.data,
        status: "closed",
        closedAt: new Date().toISOString(),
        closure: {
          done: done.map((t) => t.data.id),
          canceled: tasks
            .filter((t) => t.data.status === "canceled")
            .map((t) => t.data.id),
          incomplete: incomplete.map((t) => t.data.id),
          estimatedHours: done.reduce(
            (s, t) => s + (t.data.estimatedHours ?? 0),
            0,
          ),
          storyPoints: done.reduce((s, t) => s + (t.data.storyPoints ?? 0), 0),
        },
      },
      this.actor.name,
      row.revision,
    );
    for (const task of incomplete)
      await this.changeTask(
        (await this.store.get<Task>("task", task.data.id))!,
        value.moveTo,
      );
    return result;
  }
  async deleteSprint(input: unknown) {
    requireWrite(this.actor);
    const row = await this.sprint(input);
    if (row.data.status !== "planned")
      throw new DomainError("계획 스프린트만 삭제할 수 있습니다.");
    for (const t of await this.tasks({
      project: row.data.project,
      sprintId: row.data.id,
    }))
      await this.changeTask(
        (await this.store.get<Task>("task", t.data.id))!,
        null,
      );
    await this.store.removeMany(
      [{ kind: "sprint", id: row.data.id, revision: row.revision }],
      this.actor.name,
    );
    return { removed: 1 };
  }
  async backlog(input: unknown) {
    const data = z.object({ project: id, ...planningPage }).parse(input);
    await this.project(data.project);
    const tasks = await this.tasks({
        project: data.project,
        sprintId: "backlog",
      }),
      order = await this.store.get<{ taskIds: string[] }>(
        "backlog-order",
        data.project,
      ),
      positions = new Map((order?.data.taskIds ?? []).map((id, i) => [id, i]));
    tasks.sort(
      (a, b) =>
        (positions.get(a.data.id) ?? Number.MAX_SAFE_INTEGER) -
          (positions.get(b.data.id) ?? Number.MAX_SAFE_INTEGER) ||
        a.updatedAt.localeCompare(b.updatedAt) ||
        a.data.id.localeCompare(b.data.id),
    );
    return {
      ...page(tasks, data.offset, data.limit),
      revision: order?.revision ?? 0,
    };
  }
  async reorder(input: unknown) {
    requireWrite(this.actor);
    const value = z
      .strictObject({
        project: id,
        taskId: id,
        beforeTaskId: id.nullable(),
        revision: z.number().int().min(0),
      })
      .parse(input);
    await this.project(value.project);
    const all = (await this.tasks({ project: value.project })).sort(
        (a, b) =>
          a.updatedAt.localeCompare(b.updatedAt) ||
          a.data.id.localeCompare(b.data.id),
      ),
      ids = new Set(all.map((t) => t.data.id)),
      current = await this.store.get<{ taskIds: string[] }>(
        "backlog-order",
        value.project,
      );
    checkRevision(current, value.revision);
    if (
      !ids.has(value.taskId) ||
      (value.beforeTaskId && !ids.has(value.beforeTaskId)) ||
      value.beforeTaskId === value.taskId
    )
      throw new DomainError("같은 프로젝트의 서로 다른 태스크를 선택하세요.");
    const order = [
        ...new Set([...(current?.data.taskIds ?? []), ...ids]),
      ].filter((id) => ids.has(id) && id !== value.taskId),
      before = value.beforeTaskId
        ? order.indexOf(value.beforeTaskId)
        : order.length;
    order.splice(before, 0, value.taskId);
    return this.store.save(
      "backlog-order",
      value.project,
      { id: value.project, taskIds: order },
      this.actor.name,
      current?.revision,
    );
  }
  async resources(input: unknown) {
    const value = z
        .object({
          project: id.optional(),
          from: z.iso.date(),
          to: z.iso.date(),
          ...planningPage,
        })
        .parse(input),
      from = dayNumber(value.from),
      to = dayNumber(value.to);
    if (to < from || to - from >= 93)
      throw new DomainError("리소스 조회 기간은 1~93일로 선택하세요.");
    const people = await this.people({
        project: value.project,
        offset: value.offset,
        limit: value.limit,
      }),
      members = people.items,
      ids = new Set(members.map((m) => m.id)),
      tasks = await this.tasks({ project: value.project }),
      capacities = await this.store.list<Capacity>("member-capacity"),
      dates = Array.from({ length: to - from + 1 }, (_, i) =>
        dayString(from + i),
      );
    const rows = members.map((person) => {
      const saved = capacities.find((c) => c.data.userId === person.id),
        capacity = saved?.data ?? {
          userId: person.id,
          hoursPerDay: 8,
          weekdays: [1, 2, 3, 4, 5],
          exceptions: {},
        },
        cells = dates.map((date) => ({
          date,
          capacity: capacityAt(date, capacity),
          planned: 0,
        })),
        assigned = tasks.filter(
          (t) => t.assignedUser?.id === person.id && active(t.data),
        );
      const unplanned: { id: string; title: string; reason: string }[] = [];
      for (const { data: t } of assigned) {
        if (
          t.dueDate &&
          (t.dueDate < value.from || (t.startDate ?? t.dueDate) > value.to)
        )
          continue;
        if (t.estimatedHours == null || !t.dueDate) {
          unplanned.push({
            id: t.id,
            title: t.title,
            reason: "일정 또는 공수 미산정",
          });
          continue;
        }
        const start = dayNumber(t.startDate ?? t.dueDate),
          end = dayNumber(t.dueDate),
          count = scheduledDays(start, end, capacity);
        if (!count) {
          if (t.estimatedHours === 0) continue;
          unplanned.push({
            id: t.id,
            title: t.title,
            reason: "기간 내 근무일 없음",
          });
          continue;
        }
        for (const cell of cells) {
          const day = dayNumber(cell.date);
          if (day >= start && day <= end && cell.capacity > 0)
            cell.planned += t.estimatedHours / count;
        }
      }
      return {
        person,
        capacity,
        capacityRevision: saved?.revision ?? 0,
        cells: cells.map((c) => ({
          ...c,
          planned: Math.round(c.planned * 100) / 100,
          overloaded: Math.round(c.planned * 100) / 100 > c.capacity,
        })),
        unplanned: unplanned.slice(0, 100),
        unplannedCount: unplanned.length,
        tasks: assigned
          .filter(
            (t) =>
              t.data.dueDate &&
              t.data.dueDate >= value.from &&
              (t.data.startDate ?? t.data.dueDate) <= value.to,
          )
          .slice(0, 100)
          .map((t) => ({
            id: t.data.id,
            title: t.data.title,
            project: t.data.project,
            startDate: t.data.startDate ?? t.data.dueDate,
            dueDate: t.data.dueDate,
            estimatedHours: t.data.estimatedHours ?? null,
            inferredStart: !t.data.startDate,
          })),
      };
    });
    const unmatched = tasks.filter((t) => active(t.data) && !t.assignedUser);
    return {
      from: value.from,
      to: value.to,
      project: value.project ?? null,
      scope: "접근 가능한 프로젝트의 예정 공수",
      people: { ...people, items: rows },
      unmatched: unmatched.slice(0, 100).map((t) => ({
        id: t.data.id,
        title: t.data.title,
        assignee: t.data.assignee,
        project: t.data.project,
      })),
      unmatchedCount: unmatched.length,
      visiblePeopleOnPage: ids.size,
    };
  }
}
