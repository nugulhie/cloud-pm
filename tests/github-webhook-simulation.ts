// Actual HTTP requests are intercepted by Postman's local proxy. No credentials/writes.
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { Store } from "../src/db/store";
import { GitHubClient } from "../src/github/client";
import { GitHubChanges } from "../src/github/changes";
import { SyncQueue } from "../src/jobs/queue";
import { processNextJob } from "../src/jobs/worker";
import { receiveGithubWebhook } from "../src/webhooks/github";
import type { GitHubItem } from "../src/core/model";
assert.ok(process.env.HTTPS_PROXY, "Simulation proxy is required");
const store = new Store();
const client = new GitHubClient({ rateKey: "simulation-webhook" });
const changes = new GitHubChanges(store, client);
const queue = new SyncQueue(store);
async function deliver(event: string, data: object) {
  const text = JSON.stringify({
    repository: { full_name: "org/repo", default_branch: "main" },
    ...data,
  });
  return receiveGithubWebhook(
    new Request("http://localhost/api/webhooks/github", {
      method: "POST",
      body: text,
      headers: {
        "x-github-delivery": randomUUID(),
        "x-github-event": event,
        "x-hub-signature-256": `sha256=${createHmac("sha256", "simulation").update(text).digest("hex")}`,
      },
    }),
    queue,
    { organization: "org", secret: "simulation" },
  );
}
const issue = {
  number: 1,
  title: "Webhook PR",
  body: "",
  user: { login: "author" },
  assignees: [],
  labels: [],
  state: "open",
  html_url: "https://github.com/org/repo/pull/1",
  updated_at: "2026-11-03T00:00:00Z",
};
const pr = {
  ...issue,
  head: { sha: "a".repeat(40) },
  base: { ref: "main" },
  merged_at: null,
  requested_reviewers: [],
  changed_files: 0,
};
try {
  await deliver("issues", { issue: { ...issue, number: 2 } });
  await processNextJob(store, (_r, job) => changes.process(job));
  await deliver("pull_request", { pull_request: pr });
  assert.equal(
    (await processNextJob(store, (_r, job) => changes.process(job)))?.status,
    "completed",
  );
  const saved = (await store.get<GitHubItem>("github", "org/repo#1"))!.data;
  assert.equal(saved.filesComplete, true);
  assert.equal(saved.ci?.state, "success");
  // Real review payloads omit changed_files; cached diffs still require no HTTP.
  const { changed_files: omitted, ...reviewPayload } = pr;
  await deliver("pull_request_review", { pull_request: reviewPayload });
  assert.equal(
    (await processNextJob(store, (_r, job) => changes.process(job)))?.status,
    "completed",
  );
  // A metadata-only event reuses the same commit's files and CI.
  await deliver("pull_request", {
    pull_request: { ...pr, title: "Renamed PR" },
  });
  await processNextJob(store, (_r, job) => changes.process(job));
  assert.equal(
    (await store.get<GitHubItem>("github", "org/repo#1"))?.data.title,
    "Renamed PR",
  );
  // Fault scenario is a real mocked HTTP 403, not a fabricated exception.
  const failed = await deliver("pull_request", {
    pull_request: { ...pr, number: 99 },
  });
  assert.equal(
    (await processNextJob(store, (_r, job) => changes.process(job)))?.status,
    "pending",
  );
  const [row] = await store.query<{ attempts: number }>(
    "SELECT attempts FROM sync_jobs WHERE id=$1",
    [failed.body.delivery],
  );
  assert.equal(row?.attempts, 0);
  await deliver("issues", { issue: { ...issue, number: 3 } });
  assert.equal(
    (await processNextJob(store, (_r, job) => changes.process(job)))?.status,
    "completed",
  );
  console.log(
    "Webhook HTTP simulation passed: issue payloads, changed-PR enrichment, unchanged diff reuse, rate-limit deferral, metadata updates while limited",
  );
} finally {
  await store.close();
}
