// Run with the Postman simulation proxy, never with production credentials.
import assert from "node:assert/strict";
import { GitHubClient } from "../src/github/client";
import { collectRepository } from "../src/github/items";
assert.ok(process.env.HTTPS_PROXY, "Simulation proxy is required");
const items = await collectRepository(new GitHubClient(), "org/repo");
assert.equal(items.length, 2);
assert.deepEqual(items[0]?.labels, [{ name: "feature", color: "00aa88" }]);
assert.deepEqual(items[0]?.assignees, ["owner"]);
assert.deepEqual(items[0]?.reviewers, ["reviewer"]);
assert.deepEqual(items[0]?.reviewerTeams, ["frontend"]);
assert.deepEqual(items[1]?.labels, []);
console.log(
  "GitHub HTTP simulation: PR/issue labels, assignees and review users/teams passed",
);
