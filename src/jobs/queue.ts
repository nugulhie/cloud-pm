import type { GitHubChange } from "../webhooks/change";
import { randomUUID } from "node:crypto";
import { Store } from "../db/store";
export interface SyncJob {
  id: string;
  event: string;
  repository: string;
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  payload: GitHubChange | null;
  target_key: string | null;
  batch_cutoff: string;
  lease_token: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}
export class SyncQueue {
  constructor(private store: Store) {}
  async enqueue(
    id: string,
    event: string,
    repository: string,
    payload?: GitHubChange,
  ) {
    const key =
      payload?.type === "ci"
        ? `${repository}:ci:${payload.sha}`
        : payload?.type === "config"
          ? `${repository}:config`
          : null;
    const rows = await this.store.query(
      `INSERT INTO sync_jobs(id,event,repository,payload,target_key,available_at) VALUES($1,$2,$3,$4::jsonb,$5,now()+($6::int*interval '1 second')) ON CONFLICT(id) DO NOTHING RETURNING id`,
      [
        id,
        event,
        repository,
        payload ? JSON.stringify(payload) : null,
        key,
        payload?.type === "ci" ? 5 : 0,
      ],
    );
    return rows.length > 0;
  }
  async claim() {
    await this.store.query(
      `UPDATE sync_jobs SET status='failed',last_error='작업 임대가 만료되어 최대 시도 횟수에 도달했습니다.',lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE status='running' AND lease_expires_at<now() AND attempts>=5`,
    );
    const rows = await this.store.query<SyncJob>(
      `WITH next_job AS (SELECT id FROM sync_jobs WHERE attempts<5 AND ((status='pending' AND available_at<=now()) OR (status='running' AND lease_expires_at<now())) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE sync_jobs SET status='running',attempts=attempts+1,lease_token=$1,lease_expires_at=now()+interval '90 seconds',updated_at=now() FROM next_job WHERE sync_jobs.id=next_job.id RETURNING sync_jobs.*, (SELECT max(sequence) FROM sync_jobs) AS batch_cutoff`,
      [randomUUID()],
    );
    return rows[0];
  }
  async heartbeat(job: SyncJob) {
    const rows = await this.store.query(
      `UPDATE sync_jobs SET lease_expires_at=now()+interval '90 seconds',updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_expires_at>now() RETURNING id`,
      [job.id, job.lease_token],
    );
    return rows.length > 0;
  }
  async finish(job: SyncJob, error?: string) {
    const failed = job.attempts >= 5;
    const delay = Math.min(30 * 2 ** (job.attempts - 1), 900);
    const rows = await this.store.query(
      `WITH finished AS (UPDATE sync_jobs SET status=$3,available_at=now()+($4::int*interval '1 second'),lease_token=NULL,lease_expires_at=NULL,last_error=$5,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_expires_at>now() RETURNING id), grouped AS (UPDATE sync_jobs SET status='completed',last_error=NULL,updated_at=now() WHERE $3='completed' AND status='pending' AND sequence<=$6::bigint AND (($7::text IS NOT NULL AND target_key=$7) OR ($8::boolean AND payload IS NULL AND repository=$9)) AND EXISTS(SELECT 1 FROM finished)) SELECT id FROM finished`,
      [
        job.id,
        job.lease_token,
        error ? (failed ? "failed" : "pending") : "completed",
        error ? delay : 0,
        error?.slice(0, 2000) ?? null,
        job.batch_cutoff,
        job.target_key,
        !job.payload,
        job.repository,
      ],
    );
    return rows.length > 0;
  }
  async defer(job: SyncJob, retryAt: number, message: string) {
    const rows = await this.store.query(
      `UPDATE sync_jobs SET status='pending',attempts=GREATEST(attempts-1,0),available_at=$3,lease_token=NULL,lease_expires_at=NULL,last_error=$4,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_expires_at>now() RETURNING id`,
      [job.id, job.lease_token, new Date(retryAt).toISOString(), message],
    );
    return rows.length > 0;
  }
  async recoverLegacy() {
    await this.store.query(
      `WITH migration AS (INSERT INTO app_migrations(id) VALUES('webhook-delta-legacy-v1') ON CONFLICT DO NOTHING RETURNING id) UPDATE sync_jobs SET status='pending',attempts=0,available_at=now(),last_error=NULL WHERE status='failed' AND payload IS NULL AND EXISTS(SELECT 1 FROM migration)`,
    );
  }
  async list() {
    return this.store.query<SyncJob>(
      `SELECT id,event,repository,status,attempts,last_error,created_at,updated_at,available_at FROM sync_jobs ORDER BY created_at DESC LIMIT 100`,
    );
  }
  async retry(id: string) {
    return (
      (
        await this.store.query(
          `UPDATE sync_jobs SET status='pending',attempts=0,available_at=now(),last_error=NULL,updated_at=now() WHERE id=$1 AND status='failed' RETURNING id`,
          [id],
        )
      ).length > 0
    );
  }
}
