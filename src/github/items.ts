import { GitHubRateLimitError } from "./rate-limit";
import { z } from "zod";
import { GitHubClient } from "./client";
import type { GitHubItem } from "../core/model";
const user = z.object({ login: z.string() });
const item = z.object({
  number: z.number().int(),
  title: z.string(),
  body: z.string().nullable(),
  user: user.nullable(),
  assignees: z.array(user),
  labels: z
    .array(
      z.union([
        z.string(),
        z.object({ name: z.string(), color: z.string().optional() }),
      ]),
    )
    .default([]),
  state: z.string(),
  html_url: z.string().url(),
  updated_at: z.string(),
  pull_request: z.unknown().optional(),
});
export async function collectRepository(
  client: GitHubClient,
  repository: string,
  options: { since?: string } = {},
): Promise<GitHubItem[]> {
  z.string()
    .regex(/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/)
    .parse(repository);
  const since = options.since
    ? z.iso.datetime({ offset: true }).parse(options.since)
    : undefined;
  let issues: unknown[];
  if (since) {
    const batches = await Promise.allSettled([
      client.paginate(
        `/repos/${repository}/issues?state=all&since=${encodeURIComponent(since)}`,
      ),
      client.paginate(`/repos/${repository}/issues?state=open`),
    ]);
    const unique = new Map<number, z.infer<typeof item>>();
    let failed = false;
    for (const batch of batches) {
      if (batch.status === "rejected") {
        if (batch.reason instanceof GitHubRateLimitError) throw batch.reason;
        failed = true;
        continue;
      }
      for (const raw of batch.value) {
        const parsed = item.parse(raw);
        const previous = unique.get(parsed.number);
        if (!previous || parsed.updated_at >= previous.updated_at)
          unique.set(parsed.number, parsed);
      }
    }
    if (failed)
      throw new Error("최근 변경 또는 열린 작업 조회에 실패했습니다.");
    issues = [...unique.values()];
  } else
    issues = await client.paginate(`/repos/${repository}/issues?state=all`);
  const result: GitHubItem[] = [];
  for (const raw of issues) {
    const record = await collectItem(client, raw, repository);
    result.push(record);
  }
  return result;
}

export function parseGitHubItem(raw: unknown, repository: string): GitHubItem {
  const issue = item.parse(raw);
  const kind = issue.pull_request ? "pr" : "issue";
  const record: GitHubItem = {
    id: `${repository}#${issue.number}`,
    repository,
    number: issue.number,
    kind,
    title: issue.title,
    body: issue.body ?? "",
    author: issue.user?.login ?? "unknown",
    assignees: issue.assignees.map((a) => a.login),
    reviewers: [],
    labels: issue.labels.map((label) =>
      typeof label === "string"
        ? { name: label, color: "" }
        : { name: label.name, color: label.color ?? "" },
    ),
    state: issue.state,
    url: issue.html_url,
    updatedAt: issue.updated_at,
  };
  return record;
}
export function applyPullRequest(record: GitHubItem, raw: unknown) {
  const pr = z
    .object({
      merged_at: z.string().nullable(),
      requested_reviewers: z.array(user).default([]),
      requested_teams: z.array(z.object({ slug: z.string() })).default([]),
      changed_files: z.number().optional(),
      head: z.object({ sha: z.string() }),
      base: z.object({ ref: z.string() }).optional(),
    })
    .parse(raw);
  record.kind = "pr";
  record.state = pr.merged_at ? "merged" : record.state;
  record.mergedAt = pr.merged_at;
  record.headSha = pr.head.sha;
  record.baseBranch = pr.base?.ref;
  record.reviewers = pr.requested_reviewers.map((u) => u.login);
  record.reviewerTeams = pr.requested_teams.map((team) => team.slug);
  return pr;
}
export async function refreshPullRequestCi(
  client: GitHubClient,
  record: GitHubItem,
) {
  if (!record.headSha) return;
  const repository = record.repository;
  const pr = { head: { sha: record.headSha } };
  const ciResults = await Promise.allSettled([
    client.get(`/repos/${repository}/commits/${pr.head.sha}/status`),
    client.get(
      `/repos/${repository}/commits/${pr.head.sha}/check-runs?per_page=100`,
    ),
  ]);
  for (const result of ciResults)
    if (
      result.status === "rejected" &&
      result.reason instanceof GitHubRateLimitError
    )
      throw result.reason;
  let failed = false,
    pending = false,
    unknown = false,
    seen = false;
  const combined = ciResults[0],
    checks = ciResults[1];
  if (combined?.status === "fulfilled") {
    const parsed = z
      .object({ state: z.string(), total_count: z.number() })
      .safeParse(combined.value);
    if (parsed.success && parsed.data.total_count > 0) {
      seen = true;
      failed = ["failure", "error"].includes(parsed.data.state);
      pending = parsed.data.state === "pending";
    } else if (!parsed.success) unknown = true;
  } else unknown = true;
  if (checks?.status === "fulfilled") {
    const parsed = z
      .object({
        total_count: z.number(),
        check_runs: z.array(
          z.object({
            status: z.string(),
            conclusion: z.string().nullable(),
          }),
        ),
      })
      .safeParse(checks.value);
    if (parsed.success) {
      seen ||= parsed.data.total_count > 0;
      unknown ||= parsed.data.total_count > parsed.data.check_runs.length;
      for (const c of parsed.data.check_runs) {
        failed ||= [
          "failure",
          "timed_out",
          "cancelled",
          "action_required",
          "startup_failure",
          "stale",
        ].includes(c.conclusion ?? "");
        pending ||= c.status !== "completed";
      }
    } else unknown = true;
  } else unknown = true;
  record.ci = {
    state: failed
      ? "failure"
      : pending
        ? "pending"
        : unknown || !seen
          ? "unknown"
          : "success",
    url: `${record.url}/checks`,
  };
  record.ciHeadSha = record.headSha;
}
export async function enrichPullRequest(
  client: GitHubClient,
  record: GitHubItem,
  changedFiles?: number,
) {
  const repository = record.repository;
  const issue = record;
  const pr = { changed_files: changedFiles };
  const files = await client.paginate(
    `/repos/${repository}/pulls/${issue.number}/files`,
  );
  record.files = files.map((raw) => {
    const f = z
      .object({
        filename: z.string(),
        previous_filename: z.string().optional(),
        status: z.string(),
        additions: z.number(),
        deletions: z.number(),
        patch: z.string().optional(),
      })
      .parse(raw);
    return {
      path: f.filename,
      previousPath: f.previous_filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    };
  });
  record.filesComplete = record.files.length === pr.changed_files;
  const commits = await client.paginate(
    `/repos/${repository}/pulls/${issue.number}/commits`,
  );
  record.commitAuthors = [
    ...new Set(
      commits.map((raw) => {
        const c = z
          .object({
            author: user.nullable(),
            commit: z.object({
              author: z.object({ name: z.string() }).nullable(),
            }),
          })
          .parse(raw);
        return c.author?.login ?? c.commit.author?.name ?? "unknown";
      }),
    ),
  ];

  record.filesHeadSha = record.headSha;
}
export async function collectItem(
  client: GitHubClient,
  raw: unknown,
  repository: string,
) {
  const record = parseGitHubItem(raw, repository);
  if (record.kind === "pr") {
    const pr = applyPullRequest(
      record,
      await client.get(`/repos/${repository}/pulls/${record.number}`),
    );
    await refreshPullRequestCi(client, record);
    await enrichPullRequest(client, record, pr.changed_files);
  }
  return record;
}
