import assert from "node:assert/strict";
import { Store } from "../src/db/store";
import { GitHubClient } from "../src/github/client";
import { GitHubChanges } from "../src/github/changes";
import { processNextJob } from "../src/jobs/worker";
import { parseGitHubItem } from "../src/github/items";
import {
  enqueueReconciliations,
  type Checkpoint,
} from "../src/operations/sync-maintenance";
import type { GitHubItem } from "../src/core/model";
process.env.GITHUB_ORG = "org";
const store = new Store(),
  client = new GitHubClient({
    token: "synthetic-maintenance-token",
    rateKey: "maintenance-simulation",
  }),
  changes = new GitHubChanges(store, client);
try {
  for (const repository of ["org/repo", "org/removed"]) {
    await store.save("repository", repository, { name: repository }, "test");
    await store.save(
      "sync-checkpoint",
      repository,
      { id: repository, repository, lastSuccessAt: "2026-11-01T00:00:00Z" },
      "test",
    );
    for (const number of repository === "org/repo" ? [1, 2] : [1]) {
      const data = parseGitHubItem(
        {
          number,
          title: "이전 제목",
          body: "이전 본문",
          user: { login: "developer" },
          assignees: [],
          labels: [],
          state: "open",
          html_url: `https://github.com/${repository}/issues/${number}`,
          updated_at: "2026-11-01T00:00:00Z",
        },
        repository,
      );
      await store.save("github", data.id, data, "test");
    }
  }
  const now = new Date("2026-11-09T00:00:00Z");
  assert.equal((await enqueueReconciliations(store, now)).created, 2);
  assert.equal((await enqueueReconciliations(store, now)).created, 0);
  for (let i = 0; i < 2; i++) {
    const result = await processNextJob(store, (_, job) =>
      changes.process(job),
    );
    assert.equal(result?.status, "completed");
  }
  assert.equal(
    (await store.get<GitHubItem>("github", "org/repo#1"))?.data.title,
    "변경된 이슈 1",
  );
  const inaccessible = (await store.get<GitHubItem>("github", "org/repo#2"))!
    .data;
  assert.equal(inaccessible.sourceAvailability, "unavailable");
  assert.equal(inaccessible.body, "");
  const removed = (await store.get<Checkpoint>(
    "sync-checkpoint",
    "org/removed",
  ))!.data;
  assert.equal(removed.availability, "unavailable");
  assert.equal(removed.lastSuccessAt, "2026-11-01T00:00:00Z");
  const success = (await store.get<Checkpoint>("sync-checkpoint", "org/repo"))!
    .data;
  assert.ok(
    Date.parse(success.lastSuccessAt!) > Date.parse("2026-11-01T00:00:00Z"),
  );
  await store.save(
    "repository",
    "org/limited",
    { name: "org/limited" },
    "test",
  );
  await enqueueReconciliations(store, now);
  const result = await processNextJob(store, (_, job) => changes.process(job));
  assert.equal(result?.status, "pending");
  assert.equal(
    (await store.get<Checkpoint>("sync-checkpoint", "org/limited"))?.data
      .availability,
    undefined,
  );
  console.log(
    "incremental reconciliation, checkpoint safety, ambiguous 404, API budget deferral passed",
  );
} finally {
  await store.close();
}
