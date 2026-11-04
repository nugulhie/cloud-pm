import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { DomainError, type Stored } from "../core/model";

const schema = `CREATE TABLE IF NOT EXISTS records (workspace_id TEXT NOT NULL DEFAULT 'main',kind TEXT NOT NULL, id TEXT NOT NULL, data JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,kind,id));
ALTER TABLE records ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'main';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='records'::regclass AND conname='records_pkey' AND array_length(conkey,1)=2) THEN ALTER TABLE records DROP CONSTRAINT records_pkey; ALTER TABLE records ADD PRIMARY KEY(workspace_id,kind,id); END IF; END $$;
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, kind TEXT NOT NULL, entity_id TEXT NOT NULL, actor TEXT NOT NULL, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE events ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'main';
CREATE INDEX IF NOT EXISTS events_workspace ON events(workspace_id,created_at);
CREATE INDEX IF NOT EXISTS events_entity_revision ON events(workspace_id,kind,entity_id,(COALESCE((data->>'revision')::bigint,0)) DESC,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS sync_jobs (
 id TEXT PRIMARY KEY, event TEXT NOT NULL, repository TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 available_at TIMESTAMPTZ NOT NULL DEFAULT now(), lease_token TEXT,
 lease_expires_at TIMESTAMPTZ, last_error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE sync_jobs ADD COLUMN IF NOT EXISTS sequence BIGSERIAL;
ALTER TABLE sync_jobs ADD COLUMN IF NOT EXISTS payload JSONB;
ALTER TABLE sync_jobs ADD COLUMN IF NOT EXISTS target_key TEXT;
CREATE INDEX IF NOT EXISTS sync_jobs_ready ON sync_jobs(status,available_at);
CREATE TABLE IF NOT EXISTS sync_leases (name TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS app_users (
 id TEXT PRIMARY KEY,login TEXT UNIQUE NOT NULL,display_name TEXT NOT NULL,password_hash TEXT NOT NULL,
 github_cipher TEXT NOT NULL,github_last4 TEXT NOT NULL,repositories JSONB NOT NULL DEFAULT '[]',permissions_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 role TEXT NOT NULL DEFAULT 'member',api_token_hash TEXT UNIQUE,api_last4 TEXT,api_role TEXT NOT NULL DEFAULT 'read',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS workspace_settings (id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES app_users(id));
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS invite_only BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS workspace_invites (id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,created_by TEXT NOT NULL REFERENCES app_users(id),expected_login TEXT,expires_at TIMESTAMPTZ NOT NULL,status TEXT NOT NULL DEFAULT 'pending',accepted_by TEXT REFERENCES app_users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS app_sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL);
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '기본 워크스페이스';
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS workspace_members (workspace_id TEXT NOT NULL REFERENCES workspace_settings(id),user_id TEXT NOT NULL REFERENCES app_users(id),role TEXT NOT NULL DEFAULT 'member',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,user_id));
ALTER TABLE workspace_invites ADD COLUMN IF NOT EXISTS member_role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE workspace_invites ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'main';
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'main';
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS api_workspace_id TEXT NOT NULL DEFAULT 'main';
CREATE TABLE IF NOT EXISTS app_migrations (id TEXT PRIMARY KEY);
INSERT INTO workspace_settings(id,owner_id) SELECT 'main',id FROM app_users ORDER BY created_at,id LIMIT 1 ON CONFLICT DO NOTHING;
WITH migration AS (INSERT INTO app_migrations(id) VALUES('workspace-members-v1') ON CONFLICT DO NOTHING RETURNING id) INSERT INTO workspace_members(workspace_id,user_id,role) SELECT 'main',u.id,CASE WHEN u.id=w.owner_id THEN 'owner' ELSE 'member' END FROM app_users u JOIN workspace_settings w ON w.id='main' WHERE EXISTS(SELECT 1 FROM migration) ON CONFLICT DO NOTHING;
WITH migration AS (INSERT INTO app_migrations(id) VALUES('workspace-explicit-roles-v1') ON CONFLICT DO NOTHING RETURNING id) UPDATE workspace_members m SET role='admin' FROM app_users u WHERE m.user_id=u.id AND m.workspace_id='main' AND m.role='member' AND u.role='admin' AND EXISTS(SELECT 1 FROM migration);
CREATE TABLE IF NOT EXISTS mcp_connections (workspace_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES app_users(id),token_hash TEXT NOT NULL,last_seen TIMESTAMPTZ NOT NULL,client_name TEXT,method TEXT NOT NULL,protocol_version TEXT,PRIMARY KEY(workspace_id,user_id));
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS github_login TEXT;
UPDATE app_users SET github_login=login WHERE github_login IS NULL AND github_cipher<>'';
CREATE TABLE IF NOT EXISTS workspace_github (workspace_id TEXT PRIMARY KEY REFERENCES workspace_settings(id) ON DELETE CASCADE,github_cipher TEXT NOT NULL,github_last4 TEXT NOT NULL,github_login TEXT NOT NULL,repositories JSONB NOT NULL DEFAULT '[]',permissions_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS login_attempts (login TEXT PRIMARY KEY,attempts INTEGER NOT NULL,window_at TIMESTAMPTZ NOT NULL DEFAULT now());`;
export class Store {
  public workspaceId = "main";
  forWorkspace(workspaceId: string) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(workspaceId))
      throw new DomainError("워크스페이스 식별자가 잘못되었습니다.");
    const scoped = Object.create(this) as Store;
    scoped.workspaceId = workspaceId;
    return scoped;
  }
  private recordWorkspace(kind: string) {
    return [
      "github",
      "repository",
      "completion-config",
      "pr-snapshot",
    ].includes(kind)
      ? "main"
      : this.workspaceId;
  }

  private db: PGlite | Pool;
  private ready: Promise<unknown>;
  constructor(url?: string, path?: string) {
    if (!url && path) mkdirSync(dirname(path), { recursive: true });
    this.db = url
      ? new Pool({ connectionString: url, connectionTimeoutMillis: 10000 })
      : new PGlite(path);
    this.ready =
      this.db instanceof Pool ? this.db.query(schema) : this.db.exec(schema);
  }
  async query<T>(sql: string, values: unknown[] = []): Promise<T[]> {
    await this.ready;
    const result =
      this.db instanceof Pool
        ? await this.db.query(sql, values)
        : await this.db.query(sql, values);
    return result.rows as T[];
  }
  private inTransaction = false;
  async transaction<T>(work: (store: Store) => Promise<T>): Promise<T> {
    await this.ready;
    if (this.inTransaction) return work(this);
    const scoped = Object.create(this) as Store;
    scoped.inTransaction = true;
    if (this.db instanceof Pool) {
      const client = await this.db.connect();
      try {
        await client.query("BEGIN");
        scoped.query = async <R>(sql: string, values: unknown[] = []) =>
          (await client.query(sql, values)).rows as R[];
        const result = await work(scoped);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    return this.db.transaction(async (tx) => {
      scoped.query = async <R>(sql: string, values: unknown[] = []) =>
        (await tx.query(sql, values)).rows as R[];
      return work(scoped);
    });
  }
  async list<T>(
    kind: string,
    options: { excludeGitHubFiles?: boolean } = {},
  ): Promise<Stored<T>[]> {
    const rows = await this.query<{
      data: T;
      revision: number;
      updated_at: Date | string;
    }>(
      options.excludeGitHubFiles && kind === "github"
        ? "SELECT data - 'files' AS data, revision, updated_at FROM records WHERE kind=$1 AND workspace_id=$2 AND NOT (data ? '_deleted') ORDER BY id"
        : "SELECT data, revision, updated_at FROM records WHERE kind=$1 AND workspace_id=$2 AND NOT (data ? '_deleted') ORDER BY id",
      [kind, this.recordWorkspace(kind)],
    );
    return rows.map((r) => ({
      data: r.data,
      revision: r.revision,
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }
  async get<T>(kind: string, id: string): Promise<Stored<T> | undefined> {
    const rows = await this.query<{
      data: T;
      revision: number;
      updated_at: Date | string;
    }>(
      "SELECT data,revision,updated_at FROM records WHERE kind=$1 AND id=$2 AND workspace_id=$3 AND NOT (data ? '_deleted')",
      [kind, id, this.recordWorkspace(kind)],
    );
    const r = rows[0];
    return r
      ? {
          data: r.data,
          revision: r.revision,
          updatedAt: new Date(r.updated_at).toISOString(),
        }
      : undefined;
  }
  async save<T>(
    kind: string,
    id: string,
    data: T,
    actor: string,
    revision?: number,
  ) {
    // 데이터 갱신과 감사 이력은 단일 SQL 문장에서 원자적으로 기록한다.
    const sql =
      revision === undefined
        ? `INSERT INTO records(kind,id,data,workspace_id) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT DO NOTHING RETURNING *`
        : `UPDATE records SET data=$3::jsonb,revision=revision+1,updated_at=now() WHERE kind=$1 AND id=$2 AND workspace_id=$4 AND revision=$5 RETURNING *`;
    const values: unknown[] = [
      kind,
      id,
      JSON.stringify(data),
      this.recordWorkspace(kind),
    ];
    if (revision !== undefined) values.push(revision);
    const actorIndex = values.push(actor);
    const eventIndex = values.push(randomUUID());
    const rows = await this.query<{ revision: number }>(
      `WITH changed AS (${sql}), logged AS (INSERT INTO events(id,kind,entity_id,actor,workspace_id,data) SELECT $${eventIndex},kind,id,$${actorIndex},workspace_id,jsonb_build_object('revision',revision,'value',data) FROM changed) SELECT revision FROM changed`,
      values,
    );
    if (!rows.length)
      throw new DomainError(
        "이미 존재하거나 다른 요청이 변경했습니다. 새로고침 후 다시 시도하세요.",
        409,
      );
    return this.get<T>(kind, id);
  }
  async upsert<T>(kind: string, id: string, data: T, actor: string) {
    const current = await this.get(kind, id);
    return this.save(kind, id, data, actor, current?.revision);
  }
  async removeMany(
    targets: { kind: string; id: string; revision: number }[],
    actor: string,
  ) {
    const rows = await this.query<{ count: number }>(
      `
      WITH targets AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(kind text,id text,revision int)),
      locked AS MATERIALIZED (SELECT r.* FROM records r JOIN targets t ON r.kind=t.kind AND r.id=t.id AND r.revision=t.revision WHERE r.workspace_id=$4 AND NOT (r.data ? '_deleted') FOR UPDATE OF r),
      changed AS (UPDATE records r SET data=r.data || '{"_deleted":true}'::jsonb,revision=r.revision+1,updated_at=now() FROM locked l WHERE r.kind=l.kind AND r.id=l.id AND r.workspace_id=l.workspace_id AND (SELECT count(*) FROM locked)=(SELECT count(*) FROM targets) RETURNING r.*),
      logged AS (INSERT INTO events(id,kind,entity_id,actor,workspace_id,data) SELECT $3 || '-' || row_number() OVER(),kind,id,$2,workspace_id,jsonb_build_object('revision',revision,'value',data) FROM changed)
      SELECT count(*)::int AS count FROM changed`,
      [JSON.stringify(targets), actor, randomUUID(), this.workspaceId],
    );
    if (rows[0]?.count !== targets.length)
      throw new DomainError(
        "다른 요청이 변경했습니다. 새로고침 후 다시 시도하세요.",
        409,
      );
  }
  async history(limit = 100) {
    return this.query(
      "SELECT kind,entity_id,actor,data,created_at FROM events WHERE workspace_id=$2 ORDER BY created_at DESC LIMIT $1",
      [limit, this.workspaceId],
    );
  }
  async close() {
    await this.ready;
    if (this.db instanceof Pool) await this.db.end();
    else await this.db.close();
  }
}
const globalStore = globalThis as typeof globalThis & { pmStore?: Store };
export function getStore() {
  return (globalStore.pmStore ??= new Store(
    process.env.DATABASE_URL,
    process.env.DATA_DIR ?? "./.data/cloud-pm",
  ));
}
