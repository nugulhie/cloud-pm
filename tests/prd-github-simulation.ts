import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { GitHubApp } from "../src/github/app";
import { GitHubClient } from "../src/github/client";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
assert.ok(process.env.HTTPS_PROXY, "Postman proxy is required");
process.env.DEMO_MODE = "false";
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const app = new GitHubApp({ appId: "1234", organization: "org", privateKey });
await app.access();
const github = new GitHubClient({
  tokenProvider: app.token,
  installationScoped: true,
});
const store = new Store(),
  service = new Service(
    store,
    {
      name: "pm",
      role: "write",
      repositories: ["org/repo"],
      githubTokenProvider: app.token,
    },
    github,
  );
try {
  await service.saveProject({
    id: "p",
    name: "Admin",
    goal: "",
    featurePrefix: "ADMIN",
    repositories: ["org/repo"],
  });
  const people = await service.listGitHubAssignees({
    project: "p",
    repository: "org/repo",
  });
  assert.deepEqual(people.users.map((u) => u.login).sort(), [
    "developer",
    "ignored-user",
    "other-dev",
  ]);
  async function ready(id: string, assignee: string) {
    const row = (await service.saveRequirement({
      id,
      project: "p",
      featureName: "초대 기능",
      assignee,
    }))!;
    await service.convertRequirements({
      entries: [{ id, revision: row.revision }],
    });
    return (await service.dashboard()).requirements.find(
      (r) => r.data.id === id,
    )!;
  }
  const row = await ready("prd-1", "developer");
  await assert.rejects(
    service.publishRequirementIssue({
      id: row.data.id,
      revision: row.revision,
      repository: "org/repo",
      assignee: "missing-user",
    }),
    /배정할 수 없는/,
  );
  assert.equal(
    (await (await fetch("https://api.github.com/__mock/state")).json())
      .issueWrites,
    0,
  );
  const preview = await service.previewRequirementIssue({
    id: row.data.id,
    revision: row.revision,
    repository: "org/repo",
  });
  assert.equal(preview.title, "[ADMIN-001] 초대 기능");
  const issued = await service.publishRequirementIssue({
    id: row.data.id,
    revision: row.revision,
    repository: "org/repo",
    previewHash: preview.previewHash,
  });
  assert.equal(issued.state, "created");
  assert.equal(issued.assignmentWarning, undefined);
  const actual = (await github.get("/repos/org/repo/issues")) as {
    assignees: { login: string }[];
  }[];
  assert.deepEqual(actual[0]!.assignees, [{ login: "developer" }]);
  const ignored = await ready("prd-2", "ignored-user");
  const warning = await service.publishRequirementIssue({
    id: ignored.data.id,
    revision: ignored.revision,
    repository: "org/repo",
  });
  assert.equal(warning.state, "created");
  assert.ok(warning.assignmentWarning);
  await service.publishRequirementIssue({
    id: ignored.data.id,
    revision: ignored.revision,
    repository: "org/repo",
  });
  const state = await (
    await fetch("https://api.github.com/__mock/state")
  ).json();
  assert.equal(state.issueWrites, 2);
  assert.equal(state.issued, 1);
  console.log(
    "PRD HTTP simulation passed: GitHub people only, ADMIN numbering, 404 blocks writes, native assignees preserved, ignored assignment warning, duplicate publication blocked",
  );
} finally {
  await store.close();
}
