import { GitHubRateLimitError } from "../github/rate-limit";
import type { SyncJob } from "./queue";
import { SyncQueue } from "./queue";
import { Store } from "../db/store";
import type { SyncRun } from "../core/service";
import { DomainError } from "../core/model";

export async function processNextJob(
  store: Store,
  sync: (repository: string, job: SyncJob) => Promise<SyncRun>,
) {
  const queue = new SyncQueue(store);
  const job = await queue.claim();
  if (!job) return null;
  let lost = false;
  let renewing: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (renewing) return;
    renewing = queue
      .heartbeat(job)
      .then((ok) => {
        if (!ok) lost = true;
      })
      .catch(() => {
        lost = true;
      })
      .finally(() => {
        renewing = undefined;
      });
  }, 20000);
  timer.unref();
  let error: string | undefined;
  let rateError: GitHubRateLimitError | undefined;
  let busy = false;
  try {
    const report = await sync(job.repository, job);
    if (report.errors.length) error = report.errors.join("\n");
  } catch (e) {
    if (e instanceof GitHubRateLimitError) rateError = e;
    busy = e instanceof DomainError && e.status === 409;
    error =
      e instanceof DomainError
        ? e.message
        : "저장소 동기화 중 오류가 발생했습니다.";
  } finally {
    clearInterval(timer);
    await renewing;
  }
  if (lost) return { id: job.id, status: "lease_lost" as const };
  const finished =
    rateError || busy
      ? await queue.defer(job, rateError?.retryAt ?? Date.now() + 30000, error!)
      : await queue.finish(job, error);
  return {
    id: job.id,
    status: !finished
      ? "lease_lost"
      : error
        ? job.attempts >= 5
          ? "failed"
          : "pending"
        : "completed",
  };
}
