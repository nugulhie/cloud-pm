import { changeTargetId } from "./change-reviews";
import { publishWorkAlert } from "./work-alerts";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store } from "../db/store";
import type { Service } from "./service";
import { DomainError, id, type Actor, type Task, type Stored } from "./model";
import { requireWrite } from "./auth";
import { taskToday } from "./task-date";
import { dayNumber, dayString } from "./resources";
import {
  milestoneInput,
  releaseInput,
  type ChangeReview,
  type ChangeReviewRecord,
  type ChangeTargetRecord,
  type TaskReview,
  type Milestone,
  type Release,
} from "./review-model";
type Snapshot = Pick<
  Awaited<ReturnType<Service["dashboard"]>>,
  "projects" | "tasks" | "requirements" | "knowledge"
>;
const ref = z.strictObject({ id, revision: z.number().int().positive() });
export const scheduleInput = z.strictObject({
  task: id,
  days: z
    .number()
    .int()
    .min(-365)
    .max(365)
    .refine((v) => v !== 0),
});
const terminal = (t: Task) => ["done", "canceled"].includes(t.status);
export class Workflow {
  constructor(
    private store: Store,
    private actor: Actor,
    private snapshot: () => Promise<Snapshot>,
    private saveTask: (
      task: unknown,
      revision: number,
    ) => Promise<Stored<Task> | undefined>,
  ) {}
  private async scoped() {
    const data = await this.snapshot();
    return {
      data,
      projects: new Set(data.projects.map((p) => p.data.id)),
      tasks: new Map(data.tasks.map((t) => [t.data.id, t])),
    };
  }
  private async reviewer(userId: string) {
    const row = await this.store.query(
      "SELECT user_id FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 AND role IN ('owner','admin','member')",
      [this.store.workspaceId, userId],
    );
    if (!row.length)
      throw new DomainError(
        "검토할 수 있는 워크스페이스 멤버를 선택하세요.",
        400,
      );
  }
  private mayReview(userId: string | null) {
    if (
      userId &&
      userId !== this.actor.userId &&
      !["owner", "admin"].includes(this.actor.workspaceRole ?? "")
    )
      throw new DomainError(
        "지정된 검토자 또는 관리자만 처리할 수 있습니다.",
        403,
      );
  }
  private async get<T extends { project: string }>(
    kind: string,
    entryId: string,
    revision?: number,
  ) {
    const row = await this.store.get<T>(kind, entryId),
      { projects } = await this.scoped();
    if (!row || !projects.has(row.data.project))
      throw new DomainError("항목이 없거나 접근할 수 없습니다.", 404);
    if (revision !== undefined && row.revision !== revision)
      throw new DomainError("다른 요청이 변경했습니다. 다시 확인하세요.", 409);
    return row;
  }
  async read(operation: string, input: unknown = {}) {
    if (operation === "notification-settings") return this.settings();
    const query = z.object({ project: id.optional() }).parse(input),
      { data, projects, tasks } = await this.scoped();
    if (query.project && !projects.has(query.project))
      throw new DomainError("프로젝트에 접근할 수 없습니다.", 404);
    const rows = async <T extends { project: string }>(kind: string) =>
      (await this.store.list<T>(kind)).filter(
        (r) =>
          projects.has(r.data.project) &&
          (!query.project || query.project === r.data.project),
      );
    if (operation === "changes") {
      const page = z
        .object({
          offset: z.coerce.number().int().min(0).default(0),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        })
        .parse(input);
      const all = (await rows<ChangeReviewRecord>("change-review")).sort(
        (a, b) => b.data.createdAt.localeCompare(a.data.createdAt),
      );
      const selected = all.slice(page.offset, page.offset + page.limit),
        ids = selected.map((r) => r.data.id);
      const targets = ids.length
        ? await this.store.query<{
            data: ChangeTargetRecord;
            revision: number;
          }>(
            "SELECT data,revision FROM records WHERE workspace_id=$1 AND kind='change-target' AND NOT(data ? '_deleted') AND data->>'review'=ANY($2::text[]) ORDER BY id",
            [this.store.workspaceId, ids],
          )
        : [];
      return {
        items: selected.map((r) => ({
          ...r,
          data: {
            ...r.data,
            targets: targets
              .filter((t) => t.data.review === r.data.id)
              .map((t) => ({ ...t.data.target, recordRevision: t.revision })),
          },
          sourceCurrentRevision:
            (
              data.knowledge.find(
                (k) =>
                  r.data.sourceKind === "knowledge" &&
                  k.data.id === r.data.sourceId,
              ) ??
              data.requirements.find(
                (k) =>
                  r.data.sourceKind === "requirement" &&
                  k.data.id === r.data.sourceId,
              )
            )?.revision ?? null,
        })),
        nextOffset:
          page.offset + page.limit < all.length
            ? page.offset + page.limit
            : null,
        offset: page.offset,
      };
    }
    if (operation === "reviews")
      return {
        items: (await rows<TaskReview>("task-review")).map((r) => ({
          ...r,
          stale: tasks.get(r.data.task)?.revision !== r.data.taskRevision,
        })),
      };
    if (operation === "milestones")
      return { items: await rows<Milestone>("milestone") };
    if (operation === "releases")
      return { items: await rows<Release>("release") };
    const selected = data.tasks.filter(
        (t) => !query.project || t.data.project === query.project,
      ),
      today = taskToday();
    if (operation === "summary") {
      const { period } = z
          .object({ period: z.enum(["day", "week", "current"]).default("day") })
          .parse(input),
        weekday = new Date(today + "T00:00:00Z").getUTCDay(),
        start =
          period === "week"
            ? dayString(dayNumber(today) - ((weekday + 6) % 7))
            : today,
        end = period === "week" ? dayString(dayNumber(start) + 6) : today;
      const activity =
        period === "current"
          ? null
          : (
              await this.store.query<{
                created: number;
                completed: number;
                registeredDone: number;
                approved: number;
              }>(
                `WITH states AS (SELECT kind,entity_id,data->'value'->>'status' AS status,created_at,lag(data->'value'->>'status') OVER(PARTITION BY kind,entity_id ORDER BY COALESCE((data->>'revision')::bigint,0),created_at,id) AS previous FROM events WHERE workspace_id=$1 AND kind IN ('task','task-review') AND entity_id=ANY($2::text[]) AND NOT(COALESCE(data->'value','{}'::jsonb) ? '_deleted')) SELECT count(DISTINCT entity_id) FILTER(WHERE kind='task' AND previous IS NULL)::int AS created,count(DISTINCT entity_id) FILTER(WHERE kind='task' AND status='done' AND previous IS NOT NULL AND previous<>'done')::int AS completed,count(DISTINCT entity_id) FILTER(WHERE kind='task' AND status='done' AND previous IS NULL)::int AS "registeredDone",count(DISTINCT entity_id) FILTER(WHERE kind='task-review' AND status='approved' AND previous IS DISTINCT FROM 'approved')::int AS approved FROM states WHERE created_at>=$3 AND created_at<=now()`,
                [
                  this.store.workspaceId,
                  selected.map((t) => t.data.id),
                  new Date(start + "T00:00:00+09:00").toISOString(),
                ],
              )
            )[0];
      const active = selected.filter((t) => !terminal(t.data)),
        overdue = active.filter(
          (t) => t.data.dueDate && t.data.dueDate < today,
        ),
        blocked = active.filter(
          (t) =>
            t.data.blockedReason ||
            t.data.dependsOn?.some(
              (id) => tasks.get(id)?.data.status !== "done",
            ),
        ),
        unassigned = active.filter(
          (t) => !t.data.assigneeUserId && !t.data.assignee,
        );
      return {
        period,
        range: { startDate: start, endDate: end },
        activity,
        asOf: new Date().toISOString(),
        today,
        counts: {
          total: selected.length,
          active: active.length,
          done: selected.filter((t) => t.data.status === "done").length,
          overdue: overdue.length,
          blocked: blocked.length,
          unassigned: unassigned.length,
        },
        overdue: overdue.map((t) => t.data.id),
        blocked: blocked.map((t) => t.data.id),
        unassigned: unassigned.map((t) => t.data.id),
        milestones: await rows<Milestone>("milestone"),
        releases: await rows<Release>("release"),
      };
    }
    if (operation === "timeline")
      return {
        items: selected.map((t) => ({
          id: t.data.id,
          title: t.data.title,
          project: t.data.project,
          startDate: t.data.startDate ?? null,
          dueDate: t.data.dueDate,
          status: t.data.status,
          assignee: t.data.assignee,
          dependsOn: t.data.dependsOn ?? [],
          revision: t.revision,
        })),
        milestones: await rows<Milestone>("milestone"),
        releases: await rows<Release>("release"),
      };
    if (operation === "notification-settings") return this.settings();
    throw new DomainError("지원하지 않는 업무 조회입니다.", 404);
  }
  private async settings() {
    if (!this.actor.userId)
      throw new DomainError("개인 로그인이 필요합니다.", 401);
    const row = await this.store.get<{
      id: string;
      due: boolean;
      daily: boolean;
      weekly: boolean;
      assignments: boolean;
    }>("notification-settings", this.actor.userId);
    return (
      row ?? {
        data: {
          id: this.actor.userId,
          due: true,
          daily: true,
          weekly: true,
          assignments: true,
        },
        revision: 0,
      }
    );
  }
  async write(operation: string, input: unknown) {
    requireWrite(this.actor);
    if (operation === "schedule/preview") return this.previewSchedule(input);
    if (operation === "schedule/apply") {
      const value = scheduleInput
          .extend({
            previewHash: z.string().length(64),
            selected: z.array(id).min(1).max(500),
          })
          .parse(input),
        preview = await this.previewSchedule({
          task: value.task,
          days: value.days,
        });
      if (preview.previewHash !== value.previewHash)
        throw new DomainError(
          "일정이 변경되었습니다. 미리보기를 다시 확인하세요.",
          409,
        );
      if (
        new Set(value.selected).size !== value.selected.length ||
        value.selected.some((id) => !preview.changes.some((c) => c.id === id))
      )
        throw new DomainError("미리보기의 일정 변경 항목만 선택하세요.");
      const data = await this.snapshot();
      for (const change of preview.changes.filter((c) =>
        value.selected.includes(c.id),
      )) {
        const task = data.tasks.find((t) => t.data.id === change.id)!;
        await this.saveTask(
          {
            ...task.data,
            startDate: change.startDate,
            dueDate: change.dueDate,
          },
          task.revision,
        );
      }
      return { updated: value.selected.length };
    }
    if (operation === "notification-settings") {
      const current = await this.settings(),
        value = z
          .strictObject({
            due: z.boolean(),
            daily: z.boolean(),
            weekly: z.boolean(),
            assignments: z.boolean(),
            revision: z.number().int().min(0),
          })
          .parse(input);
      return this.store.save(
        "notification-settings",
        current.data.id,
        {
          id: current.data.id,
          due: value.due,
          daily: value.daily,
          weekly: value.weekly,
          assignments: value.assignments,
        },
        this.actor.name,
        value.revision || undefined,
      );
    }
    if (operation === "changes/update") {
      const value = z
        .strictObject({
          id: z.string().uuid(),
          revision: z.number().int().positive(),
          target: id,
          kind: z.enum(["task", "requirement"]),
          reviewerId: z.string().uuid().optional(),
          status: z.enum(["pending", "reviewed", "applied"]).optional(),
          note: z.string().max(2000).default(""),
          targetRevision: z.number().int().positive().optional(),
          targetRecordRevision: z.number().int().positive(),
          patch: z
            .strictObject({
              title: z.string().min(1).max(300).optional(),
              description: z.string().max(8000).optional(),
            })
            .optional(),
        })
        .parse(input);
      const row = await this.get<ChangeReviewRecord>(
          "change-review",
          value.id,
          value.revision,
        ),
        targetKey = changeTargetId(value.id, value.kind, value.target),
        targetRow = await this.get<ChangeTargetRecord>(
          "change-target",
          targetKey,
          value.targetRecordRevision,
        ),
        target = targetRow.data.target;
      if (targetRow.data.review !== value.id)
        throw new DomainError("검토 대상이 없습니다.", 404);
      if (!target) throw new DomainError("검토 대상이 없습니다.", 404);
      if (value.reviewerId) {
        await this.reviewer(value.reviewerId);
        target.reviewerId = value.reviewerId;
      } else this.mayReview(target.reviewerId);
      if (value.status && value.status !== "pending") {
        const source = await this.store.get(
          row.data.sourceKind,
          row.data.sourceId,
        );
        if (source?.revision !== row.data.sourceRevision)
          throw new DomainError(
            "원본에 후속 변경이 있습니다. 최신 변경 검토를 사용하세요.",
            409,
          );
        if (value.status === "applied") {
          if (
            value.kind !== "task" ||
            !value.patch ||
            !Object.keys(value.patch).length ||
            value.targetRevision === undefined
          )
            throw new DomainError(
              "반영할 태스크 필드와 현재 버전이 필요합니다.",
            );
          const { tasks } = await this.scoped(),
            task = tasks.get(target.id);
          if (!task || task.revision !== value.targetRevision)
            throw new DomainError("태스크를 다시 확인하세요.", 409);
          await this.saveTask(
            { ...task.data, ...value.patch },
            value.targetRevision,
          );
        }
        this.mayReview(target.reviewerId);
        target.reviewedBy = this.actor.name;
        target.reviewedAt = new Date().toISOString();
      }
      target.status = value.status ?? target.status;
      target.note = value.note;
      const updated = await this.store.save(
        "change-target",
        targetKey,
        { ...targetRow.data, target },
        this.actor.name,
        value.targetRecordRevision,
      );
      if (value.reviewerId)
        await publishWorkAlert(
          this.store,
          `change-review:${targetKey}:${updated!.revision}`,
          {
            task: target.kind === "task" ? target.id : "",
            recipients: [value.reviewerId],
            author: this.actor.name,
            kind: "review",
            title: "변경 검토 배정",
            body: "정책·PRD 변경 검토가 배정되었습니다.",
            destination: "changes",
          },
        );
      return updated;
    }
    if (operation === "reviews/request") {
      const value = z
          .strictObject({
            task: id,
            taskRevision: z.number().int().positive(),
            reviewerId: z.string().uuid(),
            revision: z.number().int().positive().optional(),
            note: z.string().max(2000).default(""),
          })
          .parse(input),
        { tasks } = await this.scoped(),
        task = tasks.get(value.task);
      if (!task || task.revision !== value.taskRevision)
        throw new DomainError("태스크가 변경되었습니다.", 409);
      if (task.data.status !== "done")
        throw new DomainError("완료한 태스크의 기획 검수를 요청하세요.");
      await this.reviewer(value.reviewerId);
      const review: TaskReview = {
        id: value.task,
        project: task.data.project,
        task: value.task,
        taskRevision: value.taskRevision,
        reviewerId: value.reviewerId,
        status: "pending",
        requestedBy: this.actor.name,
        requestedById: this.actor.userId,
        requestedAt: new Date().toISOString(),
        note: value.note,
      };
      const saved = await this.store.save(
        "task-review",
        review.id,
        review,
        this.actor.name,
        value.revision,
      );
      await publishWorkAlert(
        this.store,
        `qa-request:${review.id}:${saved!.revision}`,
        {
          task: review.task,
          recipients: [review.reviewerId],
          author: this.actor.name,
          kind: "review",
          title: "기획 검수 요청",
          body: "완료한 작업의 기획 검수가 요청되었습니다.",
          destination: "reviews",
        },
      );
      return saved;
    }
    if (operation === "reviews/decide") {
      const value = ref
          .extend({
            status: z.enum(["approved", "rejected"]),
            note: z.string().max(2000).min(1),
          })
          .parse(input),
        row = await this.get<TaskReview>(
          "task-review",
          value.id,
          value.revision,
        );
      this.mayReview(row.data.reviewerId);
      if (row.data.status !== "pending")
        throw new DomainError("이미 검수 결과가 기록되었습니다.", 409);
      const task = await this.store.get<Task>("task", row.data.task);
      if (
        task?.revision !== row.data.taskRevision ||
        task.data.status !== "done"
      )
        throw new DomainError(
          "검수 요청 후 작업이 변경되었습니다. 다시 요청하세요.",
          409,
        );
      const saved = await this.store.save(
        "task-review",
        value.id,
        {
          ...row.data,
          status: value.status,
          note: value.note,
          decidedBy: this.actor.name,
          decidedAt: new Date().toISOString(),
        },
        this.actor.name,
        value.revision,
      );
      if (row.data.requestedById)
        await publishWorkAlert(
          this.store,
          `qa-decision:${value.id}:${saved!.revision}`,
          {
            task: row.data.task,
            recipients: [row.data.requestedById],
            author: this.actor.name,
            kind: "review",
            title:
              value.status === "approved" ? "기획 검수 승인" : "기획 검수 반려",
            body: value.note,
            destination: "reviews",
          },
        );
      return saved;
    }
    if (operation === "milestones" || operation === "releases") {
      const parsed =
          operation === "milestones"
            ? milestoneInput.parse(input)
            : releaseInput.parse(input),
        { projects, tasks } = await this.scoped();
      if (!projects.has(parsed.project))
        throw new DomainError("프로젝트에 접근할 수 없습니다.", 404);
      if (
        new Set(parsed.taskIds).size !== parsed.taskIds.length ||
        parsed.taskIds.some(
          (id) => tasks.get(id)?.data.project !== parsed.project,
        )
      )
        throw new DomainError("같은 프로젝트의 태스크를 선택하세요.");
      const kind = operation === "milestones" ? "milestone" : "release",
        old = await this.store.get<{ project: string; status?: string }>(
          kind,
          parsed.id,
        );
      if (old && old.data.project !== parsed.project)
        throw new DomainError("프로젝트는 변경할 수 없습니다.", 409);
      if (old?.data.status === "released")
        throw new DomainError(
          "배포 기록은 수정할 수 없습니다. 후속 릴리스를 등록하세요.",
          409,
        );
      if (operation === "releases") {
        const release = parsed as z.infer<typeof releaseInput>;
        if (release.milestoneId) {
          const milestone = await this.store.get<Milestone>(
            "milestone",
            release.milestoneId,
          );
          if (milestone?.data.project !== release.project)
            throw new DomainError("같은 프로젝트의 마일스톤을 선택하세요.");
        }
        if (release.status === "released") {
          if (
            !release.actualDate ||
            release.actualDate > taskToday() ||
            !release.taskIds.length
          )
            throw new DomainError("배포한 태스크와 실제 배포일을 입력하세요.");
          for (const taskId of release.taskIds) {
            const review = await this.store.get<TaskReview>(
                "task-review",
                taskId,
              ),
              task = tasks.get(taskId)!;
            if (
              task.data.status !== "done" ||
              review?.data.status !== "approved" ||
              review.data.taskRevision !== task.revision
            )
              throw new DomainError(
                "현재 태스크 버전의 기획 승인을 마친 뒤 배포를 기록하세요.",
                409,
              );
          }
        }
      }
      const { revision, ...data } = parsed;
      return this.store.save(kind, data.id, data, this.actor.name, revision);
    }
    if (operation === "milestones/delete" || operation === "releases/delete") {
      const value = ref.parse(input),
        kind = operation.startsWith("milestones") ? "milestone" : "release",
        row = await this.get<{ project: string; status?: string }>(
          kind,
          value.id,
          value.revision,
        );
      if (row.data.status === "released")
        throw new DomainError("실제 배포 기록은 삭제할 수 없습니다.", 409);
      if (
        kind === "milestone" &&
        (await this.store.list<Release>("release")).some(
          (r) => r.data.milestoneId === value.id,
        )
      )
        throw new DomainError("릴리스에서 참조 중인 마일스톤입니다.", 409);
      await this.store.removeMany([{ kind, ...value }], this.actor.name);
      return { removed: true };
    }
    throw new DomainError("지원하지 않는 업무 수정입니다.", 404);
  }
  async validateRestoredPlan(kind: "milestone" | "release", input: unknown) {
    const value =
        kind === "milestone"
          ? milestoneInput.parse(input)
          : releaseInput.parse(input),
      { projects, tasks } = await this.scoped();
    if (
      !projects.has(value.project) ||
      value.taskIds.some((id) => tasks.get(id)?.data.project !== value.project)
    )
      throw new DomainError(
        "복구할 계획의 프로젝트·태스크 참조를 확인하세요.",
        409,
      );
    if ("milestoneId" in value && value.milestoneId) {
      const milestone = await this.store.get<Milestone>(
        "milestone",
        value.milestoneId,
      );
      if (milestone?.data.project !== value.project)
        throw new DomainError("마일스톤 참조를 먼저 복구하세요.", 409);
    }
    // Historical release evidence is preserved; restoration is not a new deployment approval.
  }
  async previewSchedule(input: unknown) {
    const value = scheduleInput.parse(input),
      { tasks } = await this.scoped(),
      root = tasks.get(value.task);
    if (!root) throw new DomainError("태스크가 없습니다.", 404);
    if (terminal(root.data))
      throw new DomainError("진행 중인 작업의 일정을 선택하세요.");
    if (!root.data.dueDate)
      throw new DomainError("기준 작업의 마감일을 먼저 지정하세요.");
    const changes: {
      id: string;
      title: string;
      revision: number;
      startDate: string | null;
      dueDate: string;
      previousStartDate: string | null;
      previousDueDate: string | null;
      reason: string;
    }[] = [];
    const known = new Map(
      [...tasks.values()]
        .filter((t) => t.data.project === root.data.project)
        .map((t) => [t.data.id, { ...t.data }]),
    );
    const apply = (task: Stored<Task>, days: number, reason: string) => {
      const start = task.data.startDate
          ? dayString(dayNumber(task.data.startDate) + days)
          : null,
        due = dayString(dayNumber(task.data.dueDate!) + days);
      known.set(task.data.id, { ...task.data, startDate: start, dueDate: due });
      changes.push({
        id: task.data.id,
        title: task.data.title,
        revision: task.revision,
        startDate: start,
        dueDate: due,
        previousStartDate: task.data.startDate ?? null,
        previousDueDate: task.data.dueDate,
        reason,
      });
    };
    apply(root, value.days, "직접 지정한 일정 변경");
    const affected = new Set([root.data.id]),
      unscheduled = new Set<string>(),
      inDegree = new Map<string, number>(),
      children = new Map<string, string[]>();
    for (const t of known.values()) {
      inDegree.set(
        t.id,
        (t.dependsOn ?? []).filter((id) => known.has(id)).length,
      );
      for (const parent of t.dependsOn ?? []) {
        const list = children.get(parent) ?? [];
        list.push(t.id);
        children.set(parent, list);
      }
    }
    const queue = [...inDegree]
      .filter(([, count]) => count === 0)
      .map(([id]) => id);
    let visited = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const taskId = queue[cursor]!,
        row = tasks.get(taskId)!;
      visited++;
      if (
        taskId !== root.data.id &&
        !terminal(row.data) &&
        row.data.dependsOn?.some((id) => affected.has(id))
      ) {
        const t = row.data;
        if (
          !t.startDate ||
          !t.dueDate ||
          (t.dependsOn ?? []).some((id) => unscheduled.has(id))
        ) {
          unscheduled.add(taskId);
          affected.add(taskId);
        } else {
          const due = Math.max(
              ...(t.dependsOn ?? []).map((id) =>
                known.get(id)?.dueDate
                  ? dayNumber(known.get(id)!.dueDate!)
                  : Number.NEGATIVE_INFINITY,
              ),
            ),
            delta = due + 1 - dayNumber(t.startDate);
          if (delta > 0) {
            apply(row, delta, "선행 작업 종료 다음 날로 조정");
            affected.add(taskId);
          }
        }
      }
      for (const child of children.get(taskId) ?? []) {
        const count = inDegree.get(child)! - 1;
        inDegree.set(child, count);
        if (count === 0) queue.push(child);
      }
    }
    if (visited !== known.size)
      throw new DomainError(
        "선행 관계에 순환이 있습니다. 관계를 먼저 확인하세요.",
        409,
      );
    const previewHash = createHash("sha256")
      .update(
        JSON.stringify({
          value,
          changes,
          versions: [...tasks.values()]
            .filter((t) => t.data.project === root.data.project)
            .map((t) => [t.data.id, t.revision]),
        }),
      )
      .digest("hex");
    return {
      task: value.task,
      days: value.days,
      changes,
      unscheduled: [...unscheduled],
      previewHash,
      policy:
        "달력 기준으로 기간을 유지합니다. 휴일·공수·배포 확정은 별도 확인이 필요합니다.",
    };
  }
}
