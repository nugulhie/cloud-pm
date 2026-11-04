// Synthetic credentials; real HTTP/TLS to the local Postman GitHub stand-in.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { GitHubApp } from "../src/github/app";
import { GitHubClient } from "../src/github/client";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
assert.ok(process.env.HTTPS_PROXY, "Postman proxy is required");
process.env.DEMO_MODE = "false";
await fetch("https://api.github.com/__mock/enable-multi-repo", {
  method: "POST",
});
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const app = new GitHubApp({ appId: "1234", organization: "org", privateKey });
const access = await app.access();
assert.deepEqual(access.repositories.sort(), ["org/backend", "org/repo"]);
const github = new GitHubClient({
  tokenProvider: app.token,
  installationScoped: true,
});
const store = new Store();
const service = new Service(
  store,
  {
    name: "pm",
    role: "write",
    repositories: access.repositories,
    githubTokenProvider: app.token,
  },
  github,
);
try {
  await service.saveProject({
    id: "product",
    name: "제품",
    goal: "",
    featurePrefix: "ADMIN",
    repositories: access.repositories,
  });
  await service.saveRequirement({
    id: "signup",
    project: "product",
    featureName: "회원가입",
  });
  await service.convertRequirements({
    entries: [{ id: "signup", revision: 1 }],
    tasks: [
      {
        id: "fe",
        title: "회원가입 화면",
        repository: "org/repo",
        assignee: "developer",
      },
      {
        id: "be",
        title: "회원가입 API",
        repository: "org/backend",
        assignee: "other-dev",
      },
    ],
  });
  const issued = [];
  for (const [taskId, repository, assignee] of [
    ["fe", "org/repo", "developer"],
    ["be", "org/backend", "other-dev"],
  ]) {
    const input = { id: "signup", revision: 2, taskId, repository };
    const preview = await service.previewRequirementIssue(input);
    assert.equal(preview.assignee, assignee);
    const result = await service.publishRequirementIssue({
      ...input,
      previewHash: preview.previewHash,
    });
    assert.equal(result.task, taskId);
    assert.equal(result.repository, repository);
    issued.push(result);
    await service.publishRequirementIssue(input);
    const originals = (await github.get(`/repos/${repository}/issues`)) as {
      number: number;
      body: string;
      assignees: { login: string }[];
    }[];
    assert.equal(originals.length, 1);
    assert.match(originals[0]!.body, new RegExp(`task: ${taskId}`));
    assert.deepEqual(originals[0]!.assignees, [{ login: assignee }]);
  }
  const dashboard = await service.dashboard();
  assert.equal(dashboard.requirementIssues.length, 2);
  assert.equal(dashboard.links.length, 2);
  assert.deepEqual(dashboard.requirements[0]!.data.taskIds, ["fe", "be"]);
  for (const issue of issued)
    assert.ok(
      dashboard.links.some(
        (l) =>
          l.data.task === issue.task &&
          l.data.item === `${issue.repository}#${issue.number}`,
      ),
    );
  const state = await (
    await fetch("https://api.github.com/__mock/state")
  ).json();
  assert.equal(state.issueWrites, 2);
  console.log(
    "PRD multi-task HTTP simulation passed: two repositories, distinct assignees, native POST/GET payloads, per-task publication links, duplicate writes blocked",
  );
} finally {
  await store.close();
}
