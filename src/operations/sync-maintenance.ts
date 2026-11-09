import type { Store } from "../db/store";
import { SyncQueue } from "../jobs/queue";
import { GitHubClient, GitHubError } from "../github/client";
import type { GitHubItem } from "../core/model";
export type Checkpoint = {
  id: string;
  repository: string;
  lastSuccessAt?: string;
  auditCursor?: string;
  lastAuditAt?: string;
  availability?: "available" | "unavailable" | "deleted";
  checkedAt?: string;
};
export async function enqueueReconciliations(store: Store, now = new Date()) {
  const cache = store.forWorkspace("main"),
    repos = await cache.list<{ name: string }>("repository"),
    queue = new SyncQueue(store),
    hour = Math.floor(now.getTime() / 3600000);
  const active = new Set(
    (
      await store.query<{ repository: string }>(
        "SELECT DISTINCT repository FROM sync_jobs WHERE event='scheduled_reconcile' AND status IN ('pending','running')",
      )
    ).map((r) => r.repository),
  );
  let created = 0;
  for (const repo of repos) {
    const name = repo.data.name.toLowerCase();
    if (active.has(name)) continue;
    if (
      process.env.GITHUB_ORG &&
      name.split("/")[0] !== process.env.GITHUB_ORG.toLowerCase()
    )
      continue;
    const checkpoint = await cache.get<Checkpoint>("sync-checkpoint", name),
      since = new Date(
        (checkpoint?.data.lastSuccessAt
          ? Date.parse(checkpoint.data.lastSuccessAt)
          : now.getTime() - 7 * 86400000) - 60000,
      ).toISOString();
    if (
      await queue.enqueue(
        `reconcile-v2:${name}:${hour}`,
        "scheduled_reconcile",
        name,
        { version: 1, type: "reconcile", since, audit: true },
      )
    )
      created++;
  }
  return { created };
}
export async function recordSourceAvailability(
  store: Store,
  repository: string,
  status: "unavailable" | "deleted",
  itemId?: string,
) {
  await store
    .forWorkspace("main")
    .query(
      `UPDATE records SET data=(data-'files'-'filesHeadSha'-'commitAuthors'-'ci'-'ciHeadSha')||jsonb_build_object('body','','filesComplete',false,'sourceAvailability',$3::text,'sourceCheckedAt',$4::text),revision=revision+1,updated_at=now() WHERE workspace_id='main' AND kind='github' AND data->>'repository'=$1 AND ($2::text IS NULL OR id=$2) AND data->>'sourceAvailability' IS DISTINCT FROM $3`,
      [repository, itemId ?? null, status, new Date().toISOString()],
    );
}
export async function auditRepository(
  store: Store,
  client: GitHubClient,
  repository: string,
  apply: (item: GitHubItem, changedFiles?: number) => Promise<void>,
) {
  const cache = store.forWorkspace("main"),
    checkpoint = await cache.get<Checkpoint>("sync-checkpoint", repository);
  try {
    await client.get(`/repos/${repository}`);
  } catch (error) {
    if (error instanceof GitHubError && [403, 404].includes(error.status)) {
      await recordSourceAvailability(cache, repository, "unavailable");
      await cache.upsert(
        "sync-checkpoint",
        repository,
        {
          ...checkpoint?.data,
          id: repository,
          repository,
          availability: "unavailable",
          checkedAt: new Date().toISOString(),
        },
        "sync-maintenance",
      );
      return false;
    }
    throw error;
  }
  const select = `SELECT data-'files'-'body' AS data FROM records WHERE workspace_id='main' AND kind='github' AND data->>'repository'=$1 AND id>$2 ORDER BY id LIMIT 20`;
  let candidates = await cache.query<{ data: GitHubItem }>(select, [
    repository,
    checkpoint?.data.auditCursor ?? "",
  ]);
  if (!candidates.length)
    candidates = await cache.query<{ data: GitHubItem }>(select, [
      repository,
      "",
    ]);
  let cursor = checkpoint?.data.auditCursor ?? "";
  for (const { data: item } of candidates) {
    try {
      const raw = (await client.get(
        `/repos/${repository}/issues/${item.number}`,
      )) as any;
      if (
        (item.sourceAvailability !== "available" &&
          item.sourceAvailability !== undefined) ||
        Date.parse(raw.updated_at) > Date.parse(item.updatedAt)
      ) {
        const { parseGitHubItem, applyPullRequest } =
          await import("../github/items");
        let incoming = parseGitHubItem(raw, repository),
          changed: number | undefined;
        if (incoming.kind === "pr") {
          const full = applyPullRequest(
            incoming,
            await client.get(`/repos/${repository}/pulls/${item.number}`),
          );
          changed = full.changed_files;
        }
        await apply(incoming, changed);
      }
    } catch (error) {
      if (error instanceof GitHubError && [403, 404].includes(error.status))
        await recordSourceAvailability(
          cache,
          repository,
          "unavailable",
          item.id,
        );
      else throw error;
    }
    cursor = item.id;
  }
  await cache.upsert(
    "sync-checkpoint",
    repository,
    {
      ...checkpoint?.data,
      id: repository,
      repository,
      availability: "available",
      checkedAt: new Date().toISOString(),
      auditCursor: cursor,
      lastAuditAt: new Date().toISOString(),
    },
    "sync-maintenance",
  );
  return true;
}
