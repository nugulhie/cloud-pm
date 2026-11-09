import { z } from "zod";
import type { Store } from "../db/store";
import { DomainError, type Actor, type Project } from "./model";
import { requireWrite } from "./auth";

type Entry = {
  kind: string;
  id: string;
  revision: number;
  data: Record<string, any>;
};
type Batch = {
  id: string;
  actor: string;
  entries: Entry[];
  created_at: string | Date;
  restored_at: string | Date | null;
};
const roots = new Set([
  "project",
  "feature",
  "task",
  "requirement",
  "knowledge",
  "milestone",
  "release",
]);
const kinds = new Set([
  ...roots,
  "comment",
  "link",
  "requirement-issue",
  "sprint",
  "backlog-order",
  "saved-view",
  "milestone",
  "release",
  "task-review",
  "change-review",
  "change-target",
]);
export class Trash {
  constructor(
    private store: Store,
    private actor: Actor,
  ) {}
  private async visible(entries: Entry[]) {
    if (!entries.some((e) => roots.has(e.kind))) return false;
    const projects = new Map(
      (await this.store.list<Project>("project")).map((r) => [
        r.data.id,
        r.data,
      ]),
    );
    for (const e of entries)
      if (e.kind === "project") projects.set(e.id, e.data as Project);
    const ids = new Set(
      entries.flatMap((e) =>
        e.kind === "project"
          ? [e.id]
          : typeof e.data.project === "string"
            ? [e.data.project]
            : [],
      ),
    );
    const allowed = this.actor.repositories?.map((r) => r.toLowerCase());
    return [...ids].every((id) => {
      const p = projects.get(id);
      return (
        !!p &&
        (!allowed ||
          p.repositories.every((r) => allowed.includes(r.toLowerCase())))
      );
    });
  }
  async list(input: unknown = {}) {
    const { offset, limit } = z
      .object({
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(input);
    // 본문·댓글을 목록으로 보내지 않고 권한 판정과 요약에 필요한 필드만 읽는다.
    const rows = await this.store.query<Batch & { count: number }>(
      `SELECT d.id,d.actor,d.created_at,d.restored_at,jsonb_array_length(d.entries)::int AS count,(SELECT jsonb_agg(jsonb_build_object('kind',e->>'kind','id',e->>'id','data',jsonb_build_object('project',e->'data'->>'project','repositories',e->'data'->'repositories','name',COALESCE(e->'data'->>'name',e->'data'->>'title',e->'data'->>'featureName',e->'data'->>'version')))) FROM jsonb_array_elements(d.entries) e WHERE e->>'kind' IN ('project','feature','task','requirement','knowledge','milestone','release')) AS entries FROM record_deletions d WHERE d.workspace_id=$1 AND d.restored_at IS NULL ORDER BY d.created_at DESC,d.id DESC LIMIT $2 OFFSET $3`,
      [this.store.workspaceId, limit, offset],
    );
    const items = [];
    for (const r of rows)
      if (r.entries && (await this.visible(r.entries)))
        items.push({
          id: r.id,
          actor: r.actor,
          deletedAt: new Date(r.created_at).toISOString(),
          count: r.count,
          names: r.entries.slice(0, 5).map((e) => String(e.data.name ?? e.id)),
        });
    return {
      items,
      offset,
      limit,
      nextOffset: rows.length === limit ? offset + limit : null,
    };
  }
  async restore(
    input: unknown,
    validate: (entry: Entry, revision: number) => Promise<unknown>,
  ) {
    requireWrite(this.actor);
    const { id } = z.strictObject({ id: z.string().uuid() }).parse(input);
    const batch = (
      await this.store.query<Batch>(
        "SELECT * FROM record_deletions WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [id, this.store.workspaceId],
      )
    )[0];
    if (!batch || !(await this.visible(batch.entries)))
      throw new DomainError("복구할 항목이 없거나 접근할 수 없습니다.", 404);
    if (batch.restored_at)
      throw new DomainError("이미 복구한 삭제 묶음입니다.", 409);
    for (const e of batch.entries) {
      if (!kinds.has(e.kind))
        throw new DomainError("지원하지 않는 삭제 항목입니다.", 409);
      const row = (
        await this.store.query<{
          revision: number;
          data: { _deleted?: boolean };
        }>(
          "SELECT revision,data FROM records WHERE workspace_id=$1 AND kind=$2 AND id=$3 FOR UPDATE",
          [this.store.workspaceId, e.kind, e.id],
        )
      )[0];
      if (!row || row.revision !== e.revision || row.data._deleted !== true)
        throw new DomainError(
          "삭제 후 항목이 변경되어 복구할 수 없습니다.",
          409,
        );
      await this.store.save(e.kind, e.id, e.data, this.actor.name, e.revision, {
        restoreDeleted: true,
      });
    }
    // 모든 참조를 먼저 복원한 뒤 현재 모델과 권한을 검증한다. 실패하면 전체 롤백된다.
    for (const e of batch.entries)
      if (roots.has(e.kind)) await validate(e, e.revision + 1);
    await this.store.query(
      "UPDATE record_deletions SET restored_at=now() WHERE id=$1 AND workspace_id=$2",
      [id, this.store.workspaceId],
    );
    return { restored: batch.entries.length, id };
  }
}
