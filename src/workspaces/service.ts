import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Store } from "../db/store";
import { DomainError, type WorkspaceRole } from "../core/model";
export class Workspaces {
  constructor(
    private store: Store,
    private userId: string,
  ) {}
  async joinDefault() {
    await this.store.query(
      "INSERT INTO workspace_settings(id,owner_id,github_org_join) SELECT 'main',id,true FROM app_users ORDER BY created_at,id LIMIT 1 ON CONFLICT DO NOTHING",
    );
    await this.store.query(
      "INSERT INTO workspace_members(workspace_id,user_id,role) SELECT id,$1,CASE WHEN owner_id=$1 THEN 'owner' ELSE 'member' END FROM workspace_settings WHERE id='main' ON CONFLICT DO NOTHING",
      [this.userId],
    );
  }
  async list() {
    return this.store.query<{
      id: string;
      name: string;
      description: string;
      role: string;
      owner_id: string;
    }>(
      "SELECT w.id,w.name,w.description,m.role,w.owner_id FROM workspace_settings w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY CASE WHEN w.id='main' THEN 0 ELSE 1 END,w.created_at,w.id",
      [this.userId],
    );
  }
  async get(id: string) {
    const row = (
      await this.store.query<{
        id: string;
        name: string;
        description: string;
        owner_id: string;
        invite_only: boolean;
        github_org_join: boolean;
        role: string;
      }>(
        "SELECT w.*,m.role FROM workspace_settings w JOIN workspace_members m ON m.workspace_id=w.id WHERE w.id=$1 AND m.user_id=$2",
        [id, this.userId],
      )
    )[0];
    if (!row) throw new DomainError("워크스페이스 접근 권한이 없습니다.", 403);
    const role: WorkspaceRole =
      row.owner_id === this.userId
        ? "owner"
        : row.role === "admin" || row.role === "member"
          ? row.role
          : "viewer";
    return { ...row, role };
  }
  async updateMember(workspaceId: string, input: unknown) {
    const data = z
      .strictObject({
        userId: z.string().uuid(),
        expectedRole: z.enum(["owner", "admin", "member", "viewer"]),
        role: z.enum(["admin", "member", "viewer"]),
      })
      .parse(input);
    return this.manageMember(workspaceId, data, data.role);
  }
  async removeMember(workspaceId: string, input: unknown) {
    const data = z
      .strictObject({
        userId: z.string().uuid(),
        expectedRole: z.enum(["owner", "admin", "member", "viewer"]),
      })
      .parse(input);
    return this.manageMember(workspaceId, data, null);
  }
  private async manageMember(
    workspaceId: string,
    data: { userId: string; expectedRole: WorkspaceRole },
    role: "admin" | "member" | "viewer" | null,
  ) {
    return this.store.transaction(async (store) => {
      const workspace = (
        await store.query<{ owner_id: string }>(
          "SELECT owner_id FROM workspace_settings WHERE id=$1 FOR UPDATE",
          [workspaceId],
        )
      )[0];
      const actor = await new Workspaces(store, this.userId).get(workspaceId);
      if (!workspace || !["owner", "admin"].includes(actor.role))
        throw new DomainError(
          "워크스페이스 관리자만 멤버를 관리할 수 있습니다.",
          403,
        );
      const target = (
        await store.query<{ role: WorkspaceRole; login: string }>(
          "SELECT m.role,u.login FROM workspace_members m JOIN app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2",
          [workspaceId, data.userId],
        )
      )[0];
      if (!target) throw new DomainError("워크스페이스 멤버가 없습니다.", 404);
      if (workspace.owner_id === data.userId)
        throw new DomainError(
          "소유자의 역할 변경·제외는 지원하지 않습니다.",
          403,
        );
      if (
        actor.role !== "owner" &&
        (target.role === "admin" || role === "admin")
      )
        throw new DomainError(
          "관리자 역할은 소유자만 변경할 수 있습니다.",
          403,
        );
      if (target.role !== data.expectedRole)
        throw new DomainError(
          "멤버 역할이 변경되었습니다. 새로고침 후 다시 시도하세요.",
          409,
        );
      if (role)
        await store.query(
          "UPDATE workspace_members SET role=$3 WHERE workspace_id=$1 AND user_id=$2",
          [workspaceId, data.userId, role],
        );
      else {
        await store.query(
          "DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
          [workspaceId, data.userId],
        );
        await store.query(
          "UPDATE app_users SET api_token_hash=NULL,api_last4=NULL WHERE id=$1 AND api_workspace_id=$2",
          [data.userId, workspaceId],
        );
        await store.query(
          "UPDATE workspace_invites SET status='revoked' WHERE workspace_id=$1 AND (((accepted_by=$2 OR expected_login=$3) AND status IN ('accepted','pending')) OR (created_by=$2 AND status='pending'))",
          [workspaceId, data.userId, target.login],
        );
      }
      const editor = (
        await store.query<{ login: string }>(
          "SELECT login FROM app_users WHERE id=$1",
          [this.userId],
        )
      )[0]!;
      await store.forWorkspace(workspaceId).upsert(
        "membership",
        data.userId,
        {
          id: data.userId,
          login: target.login,
          role,
          state: role ? "active" : "removed",
        },
        editor.login,
      );
      return { userId: data.userId, role, removed: role === null };
    });
  }
  async create(input: unknown) {
    const data = z
      .object({
        name: z.string().trim().min(1).max(100),
        description: z.string().trim().max(2000).default(""),
      })
      .parse(input);
    const id = `ws-${randomUUID()}`;
    const rows = await this.store.query<{
      id: string;
      name: string;
      description: string;
    }>(
      "WITH created AS (INSERT INTO workspace_settings(id,owner_id,name,description,invite_only) SELECT $1,id,$3,$4,true FROM app_users WHERE id=$2 RETURNING *),joined AS (INSERT INTO workspace_members(workspace_id,user_id,role) SELECT id,owner_id,'owner' FROM created) SELECT id,name,description FROM created",
      [id, this.userId, data.name, data.description],
    );
    if (!rows[0]) throw new DomainError("사용자 계정으로 로그인하세요.", 401);
    return rows[0];
  }
}
