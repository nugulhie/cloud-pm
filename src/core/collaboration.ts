import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { Store } from "../db/store";
import type { WorkAlert } from "./work-alerts";
import { demoMode, requireWrite } from "./auth";
import {
  DomainError,
  id,
  type Actor,
  type Project,
  type Stored,
  type Task,
} from "./model";

export const commentInput = z.strictObject({
  task: id,
  body: z.string().trim().min(1).max(8000),
  id: z.string().uuid().optional(),
  revision: z.number().int().positive().optional(),
});
export interface TaskComment {
  id: string;
  task: string;
  body: string;
  authorId: string;
  author: string;
  recipients: string[];
  createdAt: string;
}
type Member = {
  id: string;
  login: string;
  display_name: string;
  repositories: string[];
  shared_repositories: string[] | null;
};
export class Collaboration {
  constructor(
    private store: Store,
    private actor: Actor,
    private visibleTasks: () => Promise<Stored<Task>[]>,
  ) {}
  private identity() {
    if (this.actor.userId) return this.actor.userId;
    if (demoMode()) return "demo";
    throw new DomainError("댓글·알림에는 개인 사용자 인증이 필요합니다.", 401);
  }
  private async task(taskId: string) {
    const task = (await this.visibleTasks()).find((t) => t.data.id === taskId);
    if (!task) throw new DomainError("태스크 접근 권한이 없습니다.", 403);
    return task;
  }
  private async members(task: Task) {
    const project = (await this.store.get<Project>("project", task.project))!;
    const members = await this.store.query<Member>(
      "SELECT u.id,u.login,u.display_name,u.repositories,g.repositories AS shared_repositories FROM app_users u JOIN workspace_members m ON m.user_id=u.id LEFT JOIN workspace_github g ON g.workspace_id=m.workspace_id WHERE m.workspace_id=$1 ORDER BY u.login",
      [this.store.workspaceId],
    );
    return members.filter((m) =>
      project.data.repositories.every((r) =>
        [
          ...m.repositories,
          ...(this.actor.githubTokenProvider
            ? (this.actor.repositories ?? [])
            : (m.shared_repositories ?? [])),
        ]
          .map((repo) => repo.toLowerCase())
          .includes(r.toLowerCase()),
      ),
    );
  }
  async listComments(taskId: string) {
    const task = await this.task(id.parse(taskId));
    const comments = (await this.store.list<TaskComment>("comment"))
      .filter((r) => r.data.task === taskId)
      .sort((a, b) => a.data.createdAt.localeCompare(b.data.createdAt));
    return {
      comments: comments.map((r) => ({
        ...r,
        data: {
          id: r.data.id,
          task: r.data.task,
          body: r.data.body,
          author: r.data.author,
          authorId: r.data.authorId,
          createdAt: r.data.createdAt,
        },
      })),
      members: (await this.members(task.data)).map((m) => ({
        login: m.login,
        name: m.display_name,
      })),
      viewerId: this.actor.userId ?? (demoMode() ? "demo" : null),
    };
  }
  async saveComment(input: unknown) {
    requireWrite(this.actor);
    const authorId = this.identity(),
      data = commentInput.parse(input);
    const task = await this.task(data.task);
    const old = data.id
      ? await this.store.get<TaskComment>("comment", data.id)
      : undefined;
    if (
      data.id &&
      (!old || old.data.authorId !== authorId || old.data.task !== data.task)
    )
      throw new DomainError("본인의 댓글만 수정할 수 있습니다.", 403);
    if (data.id && !data.revision)
      throw new DomainError("수정할 댓글의 revision이 필요합니다.");
    if (!data.id && data.revision)
      throw new DomainError("새 댓글에는 revision을 지정할 수 없습니다.");
    const members = await this.members(task.data);
    const plain = data.body.replace(
      /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g,
      "",
    );
    const mentions = [
      ...plain.matchAll(/(?:^|[\s(])@([A-Za-z0-9][A-Za-z0-9-]{0,38})\b/g),
    ].map((m) => m[1]!.toLowerCase());
    if (
      mentions.some(
        (login) => !members.some((m) => m.login.toLowerCase() === login),
      )
    )
      throw new DomainError(
        "멘션은 이 프로젝트에 접근 가능한 워크스페이스 구성원만 지정할 수 있습니다.",
      );
    const participants = (await this.store.list<TaskComment>("comment"))
      .filter((r) => r.data.task === data.task)
      .map((r) => r.data.authorId);
    const recipients = members
      .filter(
        (m) =>
          m.id !== authorId &&
          (mentions.includes(m.login.toLowerCase()) ||
            m.login.toLowerCase() === task.data.assignee.toLowerCase() ||
            participants.includes(m.id)),
      )
      .map((m) => m.id);
    const comment: TaskComment = {
      id: data.id ?? randomUUID(),
      task: data.task,
      body: data.body,
      author: old?.data.author ?? this.actor.name,
      authorId,
      recipients,
      createdAt: old?.data.createdAt ?? new Date().toISOString(),
    };
    const saved = await this.store.save(
      "comment",
      comment.id,
      comment,
      this.actor.name,
      data.revision,
    );
    return { ...saved!, data: { ...saved!.data, recipients: undefined } };
  }
  async deleteComment(input: unknown) {
    requireWrite(this.actor);
    const authorId = this.identity();
    const data = z
      .strictObject({
        id: z.string().uuid(),
        revision: z.number().int().positive(),
      })
      .parse(input);
    const comment = await this.store.get<TaskComment>("comment", data.id);
    if (!comment || comment.data.authorId !== authorId)
      throw new DomainError("본인의 댓글만 삭제할 수 있습니다.", 403);
    await this.task(comment.data.task);
    await this.store.removeMany(
      [{ kind: "comment", ...data }],
      this.actor.name,
    );
    return { removed: true };
  }
  private readId(commentId: string) {
    return createHash("sha256")
      .update(`${this.identity()}:${commentId}`)
      .digest("hex");
  }
  async listNotifications() {
    const userId = this.identity();
    const tasks = new Map(
      (await this.visibleTasks()).map((r) => [r.data.id, r.data]),
    );
    const reads = new Map(
      (
        await this.store.list<{ id: string; seenRevision: number }>(
          "notification_read",
        )
      ).map((r) => [r.data.id, r.data.seenRevision]),
    );
    const visible = [...tasks.keys()];
    const comments = (
      await this.store.query<{
        data: TaskComment;
        revision: number;
        updated_at: string;
      }>(
        "SELECT data,revision,updated_at FROM records WHERE workspace_id=$1 AND kind='comment' AND NOT(data ? '_deleted') AND data->'recipients' @> $2::jsonb AND data->>'task'=ANY($3::text[]) ORDER BY updated_at DESC LIMIT 200",
        [this.store.workspaceId, JSON.stringify([userId]), visible],
      )
    ).map((r) => ({ ...r, updatedAt: new Date(r.updated_at).toISOString() }));
    const alerts = (
      await this.store.query<{
        data: WorkAlert;
        revision: number;
        updated_at: string;
      }>(
        "SELECT data,revision,updated_at FROM records WHERE workspace_id=$1 AND kind='work-alert' AND NOT(data ? '_deleted') AND data->'recipients' @> $2::jsonb AND (data->>'task'='' OR data->>'task'=ANY($3::text[])) ORDER BY updated_at DESC LIMIT 200",
        [this.store.workspaceId, JSON.stringify([userId]), visible],
      )
    ).map((r) => ({ ...r, updatedAt: new Date(r.updated_at).toISOString() }));
    const notifications = comments
      .filter(
        (r) => r.data.recipients.includes(userId) && tasks.has(r.data.task),
      )
      .map((r) => ({
        destination: undefined as WorkAlert["destination"],
        id: r.data.id,
        revision: r.revision,
        task: r.data.task,
        title: tasks.get(r.data.task)!.title,
        author: r.data.author,
        body: r.data.body.slice(0, 800),
        updatedAt: r.updatedAt,
        read: (reads.get(this.readId(r.data.id)) ?? 0) >= r.revision,
      }))
      .concat(
        alerts
          .filter(
            (r) =>
              r.data.recipients.includes(userId) &&
              (!r.data.task || tasks.has(r.data.task)),
          )
          .map((r) => ({
            destination:
              r.data.destination ??
              (r.data.kind === "weekly"
                ? "summary-week"
                : r.data.kind === "daily"
                  ? "summary-day"
                  : undefined),
            id: r.data.id,
            revision: r.revision,
            task: r.data.task,
            title: r.data.task ? tasks.get(r.data.task)!.title : r.data.title,
            author: r.data.author,
            body: r.data.body,
            updatedAt: r.updatedAt,
            read: (reads.get(this.readId(r.data.id)) ?? 0) >= r.revision,
          })),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      notifications,
      unread: notifications.filter((n) => !n.read).length,
    };
  }
  async readNotification(input: unknown) {
    const data = z
      .strictObject({
        id: z.string().uuid(),
        revision: z.number().int().positive(),
      })
      .parse(input);
    const target = (await this.listNotifications()).notifications.find(
      (n) => n.id === data.id,
    );
    if (!target) throw new DomainError("알림 접근 권한이 없습니다.", 403);
    if (data.revision > target.revision)
      throw new DomainError("알림 버전을 확인하세요.");
    const readId = this.readId(data.id);
    await this.store.query(
      `INSERT INTO records(kind,id,data,workspace_id) VALUES('notification_read',$1,$2::jsonb,$3) ON CONFLICT (workspace_id,kind,id) DO UPDATE SET data=jsonb_build_object('id',$1::text,'seenRevision',GREATEST((records.data->>'seenRevision')::int,$4::int)),revision=records.revision+1,updated_at=now()`,
      [
        readId,
        JSON.stringify({ id: readId, seenRevision: data.revision }),
        this.store.workspaceId,
        data.revision,
      ],
    );
    return { read: true };
  }
}
