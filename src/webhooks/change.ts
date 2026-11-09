import { z } from "zod";
import { parseGitHubItem, applyPullRequest } from "../github/items";
import type { GitHubItem } from "../core/model";

export type GitHubChange =
  | { version: 1; type: "item"; item: GitHubItem; changedFiles?: number }
  | { version: 1; type: "ci"; sha: string; numbers: number[] }
  | { version: 1; type: "config" }
  | { version: 1; type: "ignore" }
  | { version: 1; type: "reconcile"; since?: string; audit?: boolean }
  | { version: 1; type: "unavailable"; itemId?: string; deleted: boolean };

// 서명 검증 뒤 필요한 필드만 저장한다. 원문·인증 헤더는 보관하지 않는다.
export function normalizeGitHubChange(
  event: string,
  raw: unknown,
  repository: string,
): GitHubChange {
  const body = raw as Record<string, any>;
  if (body.action === "deleted" && event === "repository")
    return { version: 1, type: "unavailable", deleted: true };
  if (
    body.action === "deleted" &&
    event === "issues" &&
    Number.isInteger(body.issue?.number) &&
    body.issue.number > 0
  )
    return {
      version: 1,
      type: "unavailable",
      deleted: true,
      itemId: `${repository}#${body.issue.number}`,
    };
  const source = body.pull_request ?? body.issue;
  if (
    source &&
    [
      "issues",
      "issue_comment",
      "pull_request",
      "pull_request_review",
      "pull_request_review_comment",
    ].includes(event)
  ) {
    const item = parseGitHubItem(
      { ...source, body: source.body ?? null },
      repository,
    );
    let changedFiles: number | undefined;
    if (body.pull_request) {
      const pr = applyPullRequest(item, source);
      changedFiles = pr.changed_files;
    }
    return { version: 1, type: "item", item, changedFiles };
  }
  if (["check_run", "check_suite", "status"].includes(event)) {
    const check = body.check_run ?? body.check_suite ?? body;
    const sha = z
      .string()
      .regex(/^[a-f0-9]{40}$/i)
      .parse(check.head_sha ?? check.sha);
    const numbers = z
      .array(z.object({ number: z.number().int().positive() }))
      .parse(check.pull_requests ?? [])
      .map((p) => p.number);
    return { version: 1, type: "ci", sha, numbers };
  }
  if (event === "push") {
    // 커밋 목록은 잘릴 수 있으므로 기본 브랜치 push에서는 해당 저장소 설정만 갱신한다.
    return {
      version: 1,
      type:
        body.ref === `refs/heads/${body.repository?.default_branch}`
          ? "config"
          : "ignore",
    };
  }
  if (event === "repository") return { version: 1, type: "config" };
  return { version: 1, type: "reconcile" };
}
