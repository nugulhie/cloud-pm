import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
import type { GitHubItem } from "../src/core/model";
import { createMcpServer } from "../src/mcp/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

test("목록 SQL에서 diff를 제외하고 권한 있는 단일 상세와 MCP는 원본을 반환한다", async () => {
  const store = new Store();
  const item: GitHubItem = {
    id: "org/repo#1",
    repository: "org/repo",
    number: 1,
    kind: "pr",
    title: "파일 변경",
    body: "본문",
    author: "dev",
    assignees: [],
    reviewers: [],
    state: "open",
    url: "https://github.com/org/repo/pull/1",
    updatedAt: new Date().toISOString(),
    files: [
      {
        path: "large.txt",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: "+".repeat(200000),
      },
    ],
    filesComplete: true,
  };
  const service = new Service(store, {
    name: "reader",
    role: "read",
    repositories: ["org/repo"],
  });
  const server = createMcpServer(service),
    client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await store.save("github", item.id, item, "sync");
    const data = await service.dashboard();
    assert.equal(data.items[0]!.data.files, undefined);
    assert.equal(data.items[0]!.data.body, "본문");
    assert.ok(JSON.stringify(data.items).length < 2000);
    assert.equal(
      (await service.githubItem("ORG/REPO#1")).files?.[0]?.patch?.length,
      200000,
    );
    assert.equal(
      (await store.get<GitHubItem>("github", item.id))?.data.files?.[0]?.patch
        ?.length,
      200000,
    );
    await assert.rejects(
      new Service(store, {
        name: "denied",
        role: "read",
        repositories: ["org/other"],
      }).githubItem(item.id),
      { status: 404 },
    );
    await assert.rejects(service.githubItem("org/repo#2"), { status: 404 });
    await server.connect(b);
    await client.connect(a);
    const response = await client.callTool({
      name: "get_pull_request_changes",
      arguments: { repository: "org/repo", number: 1 },
    });
    assert.notEqual(response.isError, true);
    const content = response.content as { type: string; text: string }[];
    assert.equal(JSON.parse(content[0]!.text).files[0].patch.length, 200000);
  } finally {
    await client.close();
    await server.close();
    await store.close();
  }
});
