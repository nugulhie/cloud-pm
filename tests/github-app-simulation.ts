// Real HTTP/TLS through Postman; generated keys and synthetic tokens only.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { GitHubApp } from "../src/github/app";
import { GitHubClient } from "../src/github/client";
assert.ok(process.env.HTTPS_PROXY, "Simulation proxy is required");
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const app = new GitHubApp({ appId: "1234", organization: "org", privateKey });
const scopes = await Promise.all(Array.from({ length: 8 }, () => app.access()));
assert.ok(scopes.every((scope) => scope.repositories.length === 1));
const client = new GitHubClient({
  tokenProvider: app.token,
  installationScoped: true,
});
assert.deepEqual(await client.listOrganizationRepositories("org"), [
  { full_name: "org/repo" },
]);
const issue = await client.createIssue("org/repo", {
  title: "Synthetic PM issue",
  body: "Synthetic body only",
});
assert.equal(issue.number, 101);
assert.equal(issue.user.login, "cloud-pm-agent[bot]");
assert.equal(
  ((await client.get("/repos/org/repo/issues")) as unknown[]).length,
  1,
);
const state = await (await fetch("https://api.github.com/__mock/state")).json();
assert.equal(state.issued, 1);
assert.equal(state.issueWrites, 1);
await fetch("https://api.github.com/__mock/revoke", { method: "POST" });
app.invalidate();
await assert.rejects(app.access(), /HTTP 403/);
console.log(
  "GitHub App HTTP simulation passed: JWT, installation scope, shared token cache, bot issue write/read, revoked installation denied",
);
