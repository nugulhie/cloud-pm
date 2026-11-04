import { evaluateTask } from "../completion/index";
import { GitHubClient } from "./client";

export async function evaluateRepository(
  repository: string,
  client: GitHubClient,
) {
  const loaded = await client.loadTasks(repository);
  const evaluations = [];
  // 한 번의 실행 내에서 같은 PR은 동일한 조회 결과를 사용한다.
  const snapshots = new Map<
    string,
    ReturnType<GitHubClient["readPullRequest"]>
  >();
  for (const task of loaded.tasks) {
    const result = await evaluateTask(task.definition, (repo, number) => {
      const key = `${repo.toLowerCase()}#${number}`;
      let pending = snapshots.get(key);
      if (!pending) {
        pending = client.readPullRequest(repo, number);
        snapshots.set(key, pending);
      }
      return pending;
    });
    evaluations.push({ ...result, source: task.source });
  }
  return {
    repository: loaded.repository,
    branch: loaded.branch,
    commitSha: loaded.commitSha,
    evaluatedAt: new Date().toISOString(),
    evaluations,
    errors: loaded.errors,
  };
}
