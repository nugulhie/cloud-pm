import { z } from "zod";
import type { Store } from "../db/store";
import {
  DomainError,
  type Actor,
  type GitHubItem,
  type Project,
  type Task,
} from "./model";
import type { GitHubClient } from "../github/client";
import { GitHubError } from "../github/client";
import { GitHubRateLimitError } from "../github/rate-limit";
import { parseGitHubItem } from "../github/items";
import { demoMode, requireWrite } from "./auth";
export const issueAssigneesInput = z.strictObject({
  item: z.string().max(300),
  assignees: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)).max(10),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  task: z
    .object({
      id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
      revision: z.number().int().positive(),
    })
    .optional(),
});
export async function changeIssueAssignees(
  store: Store,
  actor: Actor,
  client: GitHubClient,
  input: unknown,
  saveTask: (task: Task, revision: number) => Promise<unknown>,
) {
  requireWrite(actor);
  if (demoMode())
    throw new DomainError("데모에서는 GitHub 이슈 담당자를 변경하지 않습니다.");
  const value = issueAssigneesInput.parse(input),
    cached = await store.get<GitHubItem>("github", value.item);
  if (
    !cached ||
    cached.data.kind !== "issue" ||
    (actor.repositories &&
      !actor.repositories.includes(cached.data.repository.toLowerCase()))
  )
    throw new DomainError("GitHub 이슈 접근 권한이 없습니다.", 403);
  const projects = (await store.list<Project>("project")).filter(
    (p) =>
      !actor.repositories ||
      p.data.repositories.every((r) =>
        actor.repositories!.includes(r.toLowerCase()),
      ),
  );
  if (
    !projects.some((p) => p.data.repositories.includes(cached.data.repository))
  )
    throw new DomainError(
      "워크스페이스 프로젝트에 연결된 저장소의 이슈를 선택하세요.",
      403,
    );
  let task = value.task
    ? await store.get<Task>("task", value.task.id)
    : undefined;
  if (value.task) {
    if (!task || task.revision !== value.task.revision)
      throw new DomainError("태스크가 변경되었습니다. 다시 확인하세요.", 409);
    if (
      !projects.some((p) => p.data.id === task!.data.project) ||
      !(
        await store.list<{ task: string; item: string; status: string }>("link")
      ).some(
        (l) =>
          l.data.task === task!.data.id &&
          l.data.item === value.item &&
          l.data.status === "approved",
      )
    )
      throw new DomainError(
        "승인 연결된 태스크만 함께 변경할 수 있습니다.",
        403,
      );
    if (value.assignees.length > 1)
      throw new DomainError("내부 태스크는 담당자 한 명만 지정할 수 있습니다.");
  }
  const path = `/repos/${cached.data.repository}/issues/${cached.data.number}`;
  const latest = parseGitHubItem(
    await client.get(path),
    cached.data.repository,
  );
  if (latest.kind !== "issue" || latest.updatedAt !== value.expectedUpdatedAt)
    throw new DomainError(
      "GitHub 원본이 변경되었습니다. 최신 내용으로 다시 확인하세요.",
      409,
    );
  const requested = [...new Set(value.assignees.map((a) => a.toLowerCase()))];
  for (const login of requested)
    if (!(await client.canAssign(cached.data.repository, login)))
      throw new DomainError("이 저장소에 배정할 수 없는 GitHub 사용자입니다.");
  let remote: GitHubItem;
  try {
    remote = parseGitHubItem(
      await client.updateIssueAssignees(
        cached.data.repository,
        cached.data.number,
        requested,
      ),
      cached.data.repository,
    );
  } catch (error) {
    if (error instanceof GitHubRateLimitError) throw error;
    throw new DomainError(
      error instanceof GitHubError &&
        [400, 401, 403, 404, 410, 422].includes(error.status)
        ? `GitHub 담당자 변경 실패 (HTTP ${error.status}). Issues 쓰기 권한을 확인하세요.`
        : "GitHub 변경 응답을 확인하지 못했습니다. 원본을 새로고침해 담당자를 확인하세요. 자동으로 재시도하지 않습니다.",
      502,
    );
  }
  const actual = [...remote.assignees].map((a) => a.toLowerCase()).sort();
  const verified =
    JSON.stringify(actual) === JSON.stringify([...requested].sort());
  // 원격 성공 후 내부 충돌은 원격 변경을 되돌리지 않고 부분 성공으로 보고한다.
  let cacheSaved = true,
    taskUpdated = false,
    warning = verified
      ? ""
      : "GitHub가 일부 담당자 배정을 반영하지 않았습니다. 원본 담당자를 확인하세요.";
  try {
    await store.upsert("github", remote.id, remote, actor.name);
  } catch {
    cacheSaved = false;
    warning =
      "GitHub 담당자는 변경되었지만 내부 캐시 갱신에 실패했습니다. 원본을 확인하고 새로고침하세요.";
  }
  if (task && verified) {
    try {
      await saveTask(
        {
          ...task.data,
          assignee: requested[0] ?? "",
          assigneeUserId: undefined,
        },
        value.task!.revision,
      );
      taskUpdated = true;
    } catch {
      warning =
        "GitHub 담당자는 변경되었지만 내부 태스크는 동시 변경 또는 권한 변경으로 갱신하지 못했습니다. 태스크를 다시 확인하세요.";
    }
  }
  return {
    item: remote,
    verified,
    cacheSaved,
    taskUpdated,
    partial: !verified || !cacheSaved || (!!task && !taskUpdated),
    ...(warning ? { warning } : {}),
  };
}
