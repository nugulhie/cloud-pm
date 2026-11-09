import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Store } from "../db/store";
import { DomainError, type Actor } from "../core/model";
import type { Checkpoint } from "./sync-maintenance";
import { publishWorkAlert } from "../core/work-alerts";
const healthSchema = z.object({
  checkedAt: z.iso.datetime(),
  diskUsedPercent: z.number().min(0).max(100),
  app: z.boolean(),
  worker: z.boolean(),
  database: z.boolean(),
});
const backupSchema = z.object({
  checkedAt: z.iso.datetime(),
  lastSuccessAt: z.iso.datetime().nullable(),
  verified: z.boolean(),
  offsite: z.boolean(),
  ok: z.boolean(),
  bytes: z.number().nonnegative().optional(),
});
async function statusFile<T>(name: string, schema: z.ZodType<T>) {
  try {
    const path = process.env.OPERATIONS_STATUS_DIR;
    if (!path) return null;
    const text = await readFile(`${path}/${name}.json`, "utf8");
    if (text.length > 16000) return null;
    return schema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}
export async function operationStatus(store: Store, actor: Actor) {
  if (!actor.admin && !["owner", "admin"].includes(actor.workspaceRole ?? ""))
    throw new DomainError(
      "운영 현황은 워크스페이스 관리자만 조회할 수 있습니다.",
      403,
    );
  const rows = await store.query<{
    status: string;
    count: number;
    oldest: string | null;
  }>(
    "SELECT status,count(*)::int AS count,min(created_at) AS oldest FROM sync_jobs WHERE ($1::text[] IS NULL OR repository=ANY($1::text[])) GROUP BY status",
    [actor.repositories ?? null],
  );
  const checkpoints = (
    await store.forWorkspace("main").list<Checkpoint>("sync-checkpoint")
  )
    .filter(
      (r) =>
        !actor.repositories || actor.repositories.includes(r.data.repository),
    )
    .map((r) => r.data);
  const backup = await statusFile("backup", backupSchema),
    health = await statusFile("health", healthSchema),
    now = Date.now(),
    warnings: string[] = [];
  if (rows.some((r) => r.status === "failed" && r.count > 0))
    warnings.push("재처리가 필요한 동기화 작업이 있습니다.");
  if (
    checkpoints.some(
      (c) => c.availability === "unavailable" || c.availability === "deleted",
    )
  )
    warnings.push("원본 접근을 확인해야 할 GitHub 저장소가 있습니다.");
  if (
    rows.some(
      (r) =>
        r.status === "pending" &&
        r.oldest &&
        now - Date.parse(r.oldest) > 900000,
    )
  )
    warnings.push("15분 이상 대기한 동기화 작업이 있습니다.");
  if (
    backup &&
    (!backup.ok ||
      !backup.verified ||
      !backup.lastSuccessAt ||
      now - Date.parse(backup.lastSuccessAt) > 36 * 3600000)
  )
    warnings.push("백업 또는 격리 복원 검증 상태를 확인하세요.");
  if (
    health &&
    (health.diskUsedPercent >= 80 ||
      !health.app ||
      !health.worker ||
      !health.database ||
      now - Date.parse(health.checkedAt) > 300000)
  )
    warnings.push("서버 상태 또는 저장 공간을 확인하세요.");
  return {
    asOf: new Date().toISOString(),
    queue: rows,
    checkpoints,
    backup,
    health,
    warnings,
    backupConfigured: !!backup,
    monitorConfigured: !!health,
  };
}
export async function operationAlertTick(store: Store, now = new Date()) {
  const workspaces = await store.query<{ id: string }>(
    "SELECT id FROM workspace_settings",
  );
  for (const w of workspaces) {
    const scoped = store.forWorkspace(w.id),
      status = await operationStatus(scoped, {
        name: "system",
        role: "read",
        workspaceRole: "owner",
      });
    if (!status.warnings.length) continue;
    const admins = await store.query<{ user_id: string }>(
      "SELECT user_id FROM workspace_members WHERE workspace_id=$1 AND role IN ('owner','admin')",
      [w.id],
    );
    await publishWorkAlert(
      scoped,
      `operations:${now.toISOString().slice(0, 10)}`,
      {
        task: "",
        recipients: admins.map((a) => a.user_id),
        author: "운영 점검",
        kind: "review",
        destination: "jobs",
        title: "운영 상태 확인 필요",
        body: "동기화 작업 큐 또는 백업·서버 상태를 작업 큐 화면에서 확인하세요.",
      },
      now,
    );
  }
}
