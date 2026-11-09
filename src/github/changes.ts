import { taskWorkAlerts } from "../core/work-alerts";
import { acquireSyncLease } from "../jobs/lease";
import { randomUUID } from "node:crypto";
import { Store } from "../db/store";
import type { GitHubItem, Project, Task } from "../core/model";
import type { SyncRun } from "../core/service";
import type { SyncJob } from "../jobs/queue";
import { SyncQueue } from "../jobs/queue";
import { GitHubClient, GitHubError } from "./client";
import {
  applyPullRequest,
  enrichPullRequest,
  parseGitHubItem,
  refreshPullRequestCi,
} from "./items";
import { evaluateTask, type PullRequestSnapshot } from "../completion/index";
import { GitHubRateLimitError } from "./rate-limit";
import {
  auditRepository,
  recordSourceAvailability,
  type Checkpoint,
} from "../operations/sync-maintenance";

type CompletionIndex = Awaited<ReturnType<GitHubClient["loadTasks"]>>;
const actor = "webhook-worker";
export async function cacheCompletionIndex(
  store: Store,
  index: CompletionIndex,
) {
  await store.upsert("completion-config", index.repository, index, actor);
}

export class GitHubChanges {
  constructor(
    private store: Store,
    private client: GitHubClient,
  ) {}
  async bootstrap() {
    const queue = new SyncQueue(this.store);
    await queue.recoverLegacy();
    const indexes = new Set(
      (await this.store.list<CompletionIndex>("completion-config")).map(
        (r) => r.data.repository,
      ),
    );
    const repositories = await this.store.list<{ name: string }>("repository");
    for (const { data } of repositories) {
      const repository = data.name.toLowerCase();
      if (
        repository.split("/")[0] !== process.env.GITHUB_ORG?.toLowerCase() ||
        indexes.has(repository)
      )
        continue;
      // 구버전 데이터에는 YAML 색인만 한 번 보충한다. 이슈·PR 전체 수집은 하지 않는다.
      await queue.enqueue(
        `config-bootstrap-v1:${repository}`,
        "config_bootstrap",
        repository,
        { version: 1, type: "config" },
      );
    }
  }
  async process(job: SyncJob): Promise<SyncRun> {
    const lease = await acquireSyncLease(this.store);
    try {
      return await this.apply(job);
    } finally {
      await lease.close();
    }
  }
  private async apply(job: SyncJob): Promise<SyncRun> {
    const run: SyncRun = {
      id: job.id,
      startedAt: new Date().toISOString(),
      finishedAt: "",
      errors: [],
      warnings: [],
      repositories: 1,
    };
    const change = job.payload;
    if (change?.type === "unavailable") {
      await recordSourceAvailability(
        this.store,
        job.repository,
        change.deleted ? "deleted" : "unavailable",
        change.itemId,
      );
      run.finishedAt = new Date().toISOString();
      return run;
    }
    if (!change || change.type === "reconcile") {
      const rows = await this.store.query<{ since: string }>(
        `SELECT min(created_at) AS since FROM sync_jobs WHERE repository=$1 AND payload IS NULL AND status IN ('pending','running')`,
        [job.repository],
      );
      const since =
        change?.type === "reconcile" && change.since
          ? new Date(change.since).toISOString()
          : new Date(
              new Date(rows[0]?.since ?? job.created_at).getTime() - 60000,
            ).toISOString();
      // 구버전 큐 복구: 변경분만 조회하며 열린 항목 전체 조회도 하지 않는다.
      let changed: unknown[];
      try {
        changed = await this.client.paginate(
          `/repos/${job.repository}/issues?state=all&sort=updated&direction=asc&since=${encodeURIComponent(since)}`,
        );
      } catch (error) {
        if (
          change?.type === "reconcile" &&
          change.audit &&
          error instanceof GitHubError &&
          [403, 404].includes(error.status)
        ) {
          await recordSourceAvailability(
            this.store,
            job.repository,
            "unavailable",
          );
          const cache = this.store.forWorkspace("main"),
            previous = await cache.get<Checkpoint>(
              "sync-checkpoint",
              job.repository,
            );
          await cache.upsert(
            "sync-checkpoint",
            job.repository,
            {
              ...previous?.data,
              id: job.repository,
              repository: job.repository,
              availability: "unavailable",
              checkedAt: new Date().toISOString(),
            },
            actor,
          );
          run.warnings!.push(
            `${job.repository}: 삭제 또는 권한 변경으로 원본을 확인할 수 없습니다.`,
          );
          run.finishedAt = new Date().toISOString();
          return run;
        }
        throw error;
      }
      for (const raw of changed) {
        const incoming = parseGitHubItem(raw, job.repository);
        if (incoming.kind === "pr") {
          const pr = applyPullRequest(
            incoming,
            await this.client.get(
              `/repos/${job.repository}/pulls/${incoming.number}`,
            ),
          );
          await this.updateItem(incoming, pr.changed_files);
        } else await this.updateItem(incoming);
      }
      if (change?.type === "reconcile" && change.audit) {
        const available = await auditRepository(
          this.store,
          this.client,
          job.repository,
          (item, changed) => this.updateItem(item, changed, true),
        );
        if (!available) {
          run.warnings!.push(`${job.repository}: 원본 접근 상태를 확인하세요.`);
          run.finishedAt = new Date().toISOString();
          return run;
        }
      }
      const cache = this.store.forWorkspace("main"),
        checkpoint = await cache.get<Checkpoint>(
          "sync-checkpoint",
          job.repository,
        );
      await cache.upsert(
        "sync-checkpoint",
        job.repository,
        {
          ...checkpoint?.data,
          id: job.repository,
          repository: job.repository,
          lastSuccessAt: run.startedAt,
        },
        actor,
      );
      await this.evaluate();
    } else if (change.type === "item") {
      await this.updateItem(change.item, change.changedFiles);
      if (change.item.kind === "pr") await this.evaluate(change.item.id);
    } else if (change.type === "ci") {
      let items = (
        await this.store.list<GitHubItem>("github", {
          excludeGitHubFiles: true,
        })
      )
        .map((r) => r.data)
        .filter(
          (i) =>
            i.repository === job.repository &&
            i.kind === "pr" &&
            i.headSha === change.sha,
        );
      if (!items.length) {
        let numbers = change.numbers;
        if (!numbers.length) {
          const matches = await this.client.paginate(
            `/repos/${job.repository}/commits/${change.sha}/pulls`,
          );
          numbers = matches.map((raw) => {
            const pr = raw as { number: number };
            if (!Number.isInteger(pr.number) || pr.number <= 0)
              throw new Error("잘못된 PR 번호");
            return pr.number;
          });
        }
        for (const number of numbers) {
          const raw = await this.client.get(
            `/repos/${job.repository}/pulls/${number}`,
          );
          const record = parseGitHubItem(
            { ...(raw as object), pull_request: {} },
            job.repository,
          );
          const pr = applyPullRequest(record, raw);
          if (record.headSha !== change.sha) continue;
          await this.updateItem(record, pr.changed_files);
          items.push(record);
        }
      }
      // 같은 커밋의 CI 이벤트는 한 번 조회해 관련 PR에 반영한다.
      if (items.length) {
        const sample = { ...items[0]! };
        await refreshPullRequestCi(this.client, sample);
        for (const item of items) {
          const latest = await this.store.get<GitHubItem>("github", item.id);
          if (latest?.data.headSha === change.sha)
            await this.store.upsert(
              "github",
              item.id,
              {
                ...latest.data,
                ci: { ...sample.ci!, url: `${item.url}/checks` },
                ciHeadSha: change.sha,
              },
              actor,
            );
        }
      }
    } else if (change.type === "config") {
      let index: CompletionIndex;
      try {
        index = await this.client.loadTasks(job.repository);
      } catch (error) {
        if (!(error instanceof GitHubError && error.status === 404))
          throw error;
        index = {
          repository: job.repository,
          branch: "",
          commitSha: "",
          tasks: [],
          errors: [],
        };
      }
      await cacheCompletionIndex(this.store, index);
      run.warnings!.push(
        ...index.errors.map(
          (e) => `${index.repository}/${e.path}: ${e.message}`,
        ),
      );
      await this.evaluate();
    }
    run.finishedAt = new Date().toISOString();
    return run;
  }
  private async updateItem(
    incoming: GitHubItem,
    changedFiles?: number,
    verified = false,
  ): Promise<void> {
    const old = (await this.store.get<GitHubItem>("github", incoming.id))?.data;
    if (old && Date.parse(old.updatedAt) > Date.parse(incoming.updatedAt))
      return;
    if (
      old?.sourceAvailability &&
      old.sourceAvailability !== "available" &&
      !verified &&
      Date.parse(old.updatedAt) >= Date.parse(incoming.updatedAt)
    )
      return;
    const record: GitHubItem = {
      ...old,
      ...incoming,
      sourceAvailability: "available",
      sourceCheckedAt: new Date().toISOString(),
      files: old?.files,
      filesComplete: old?.filesComplete,
      filesHeadSha: old?.filesHeadSha,
      commitAuthors: old?.commitAuthors,
      ci: old?.ci,
      ciHeadSha: old?.ciHeadSha,
    };
    if (incoming.kind === "pr" && !incoming.headSha && old) {
      // issue_comment에는 머지·리뷰어 정보가 없다. 이미 수집한 PR 정보를 보존한다.
      record.state = old.state === "merged" ? "merged" : incoming.state;
      record.reviewers = old.reviewers;
      record.reviewerTeams = old.reviewerTeams;
    }
    if (record.headSha && record.filesHeadSha !== record.headSha) {
      record.files = undefined;
      record.filesComplete = false;
      record.commitAuthors = undefined;
      record.ci = undefined;
    }
    // 한도 대기 중에도 웹훅 메타데이터·완료 상태는 먼저 반영한다.
    await this.store.upsert("github", record.id, record, actor);
    if (
      record.kind === "pr" &&
      record.baseBranch &&
      record.mergedAt !== undefined
    ) {
      await this.store.upsert(
        "pr-snapshot",
        record.id,
        {
          state: record.state === "open" ? "open" : "closed",
          mergedAt: record.mergedAt,
          targetBranch: record.baseBranch,
          observedAt: new Date().toISOString(),
        } satisfies PullRequestSnapshot,
        actor,
      );
      await this.evaluate(record.id);
    }
    if (
      record.kind === "pr" &&
      record.headSha &&
      record.filesHeadSha !== record.headSha
    ) {
      if (changedFiles === undefined) {
        const raw = await this.client.get(
          `/repos/${record.repository}/pulls/${record.number}`,
        );
        const latest = parseGitHubItem(
          { ...(raw as object), pull_request: {} },
          record.repository,
        );
        const details = applyPullRequest(latest, raw);
        if (details.changed_files === undefined)
          throw new Error("PR 변경 파일 수 응답 누락");
        return this.updateItem(latest, details.changed_files);
      }
      await enrichPullRequest(this.client, record, changedFiles);
      // diff를 먼저 체크포인트로 저장해 CI 실패 시 파일 전체를 다시 읽지 않는다.
      await this.store.upsert("github", record.id, record, actor);
    }
    if (
      record.kind === "pr" &&
      record.headSha &&
      record.ciHeadSha !== record.headSha
    ) {
      await refreshPullRequestCi(this.client, record);
      await this.store.upsert("github", record.id, record, actor);
    }
  }
  private async evaluate(changedId?: string) {
    const indexes = (
      await this.store.list<CompletionIndex>("completion-config")
    ).map((r) => r.data);
    const counts = new Map<string, number>();
    for (const index of indexes)
      for (const config of index.tasks)
        counts.set(
          config.definition.task,
          (counts.get(config.definition.task) ?? 0) + 1,
        );
    const workspaceIds = [
      ...new Set([
        "main",
        ...(
          await this.store.query<{ id: string }>(
            "SELECT id FROM workspace_settings",
          )
        ).map((w) => w.id),
      ]),
    ];
    for (const id of workspaceIds) {
      const scoped = this.store.forWorkspace(id);
      const projects = (await scoped.list<Project>("project")).map(
        (r) => r.data,
      );
      for (const index of indexes)
        for (const config of index.tasks) {
          const d = config.definition;
          const rules =
            "all" in d.completion ? d.completion.all : d.completion.any;
          if (
            changedId &&
            !rules.some(
              (r) =>
                `${r.pull_request.repository.toLowerCase()}#${r.pull_request.number}` ===
                changedId,
            )
          )
            continue;
          if (counts.get(d.task) !== 1) continue;
          const task = await scoped.get<Task>("task", d.task);
          const project = projects.find((p) => p.id === d.project);
          if (
            !task ||
            task.data.project !== d.project ||
            task.data.feature !== d.feature ||
            !project?.repositories.includes(index.repository) ||
            rules.some(
              (r) =>
                !project.repositories.includes(
                  r.pull_request.repository.toLowerCase(),
                ),
            )
          )
            continue;
          let rateError: GitHubRateLimitError | undefined;
          const result = await evaluateTask(d, async (repository, number) => {
            const key = `${repository.toLowerCase()}#${number}`;
            const cached = await this.store.get<PullRequestSnapshot>(
              "pr-snapshot",
              key,
            );
            if (cached) return cached.data;
            try {
              const snapshot = await this.client.readPullRequest(
                repository,
                number,
              );
              await this.store.upsert("pr-snapshot", key, snapshot, actor);
              return snapshot;
            } catch (error) {
              if (error instanceof GitHubRateLimitError) rateError = error;
              throw error;
            }
          });
          if (rateError) throw rateError;
          await scoped.save(
            "evaluation",
            randomUUID(),
            {
              ...result,
              source: config.source,
              evaluatedAt: new Date().toISOString(),
            },
            actor,
          );
          if (
            result.state === "satisfied" &&
            !["canceled", "done"].includes(task.data.status)
          ) {
            const saved = await scoped.save<Task>(
              "task",
              d.task,
              { ...task.data, status: "done" },
              actor,
              task.revision,
            );
            if (saved)
              await taskWorkAlerts(
                scoped,
                { name: actor, role: "write" },
                task,
                saved,
              );
          }
        }
    }
  }
}
