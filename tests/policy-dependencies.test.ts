import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
import { createMcpServer } from "../src/mcp/server";
import {
  knowledgeInput,
  type KnowledgeEntry,
} from "../src/core/knowledge-model";
import {
  policyGraph,
  policyDependents,
  policyPath,
} from "../src/core/policy-dependencies";
import type { GitHubItem, Stored } from "../src/core/model";

const policy = (id: string, dependsOn?: string[]) => ({
  id,
  kind: "policy",
  name: id,
  content: `정책 ${id}`,
  ...(dependsOn ? { dependsOn } : {}),
});
const base = (store: Store) =>
  new Service(store, { name: "editor", role: "write" });

test("정책 의존관계: 생략 보존·명시 해제·중복 제거·순환/워크스페이스 검증과 삭제 보호", async () => {
  const store = new Store(),
    service = base(store);
  try {
    const c = await service.saveKnowledge(policy("c"));
    assert.ok(c);
    await service.saveKnowledge(policy("b", ["c"]));
    let a = await service.saveKnowledge(policy("a", ["b", "b"]));
    assert.ok(a);
    assert.deepEqual(a.data.dependsOn, ["b"]);
    a = await service.saveKnowledge(
      { ...policy("a"), content: "이전 클라이언트 편집" },
      a.revision,
    );
    assert.ok(a);
    assert.deepEqual(a.data.dependsOn, ["b"]);
    await assert.rejects(
      service.saveKnowledge(policy("c", ["a"]), c.revision),
      /순환/,
    );
    await assert.rejects(
      service.saveKnowledge(policy("a", ["a"]), a.revision),
      /자기 자신/,
    );
    await service.saveKnowledge({
      id: "term",
      kind: "glossary",
      name: "용어",
      content: "정의",
    });
    for (const id of ["missing", "term", "other-workspace"])
      await assert.rejects(
        service.saveKnowledge(policy("a", [id]), a.revision),
        /현재 워크스페이스/,
      );
    await store.forWorkspace("private").save(
      "knowledge",
      "other-workspace",
      {
        ...knowledgeInput.parse(policy("other-workspace")),
        editor: "private",
      },
      "private",
    );
    await assert.rejects(
      service.saveKnowledge(policy("a", ["other-workspace"]), a.revision),
      /현재 워크스페이스/,
    );
    await assert.rejects(
      service.saveKnowledge({
        id: "invalid-term",
        kind: "glossary",
        name: "다른 용어",
        content: "정의",
        dependsOn: ["c"],
      }),
      /정책끼리/,
    );
    await assert.rejects(
      service.deleteKnowledge({ id: "c", revision: c.revision }),
      /다른 정책이 의존/,
    );
    await assert.rejects(service.saveKnowledge(policy("a", []), 99), {
      status: 409,
    });
    await service.patchEntity({
      kind: "knowledge",
      id: "a",
      revision: a.revision,
      patch: { dependsOn: [] },
    });
    assert.deepEqual(
      (await store.get<KnowledgeEntry>("knowledge", "a"))!.data.dependsOn,
      [],
    );
    const changes = await service.history();
    assert.ok(
      changes.some(
        (r) =>
          r.targetId === "a" &&
          r.changes.some((c) => c.field === "의존 정책" && c.after === "없음"),
      ),
    );
    const b = (await store.get<KnowledgeEntry>("knowledge", "b"))!;
    await service.saveKnowledge(policy("b", []), b.revision);
    assert.equal(
      (await service.deleteKnowledge({ id: "c", revision: c.revision }))
        .removed,
      1,
    );
    await assert.rejects(
      new Service(store, { name: "reader", role: "read" }).saveKnowledge(
        policy("no-write"),
      ),
      { status: 403 },
    );
  } finally {
    await store.close();
  }
});

test("동시에 반대 정책 연결을 저장해도 순환 관계를 만들 수 없다", async () => {
  const store = new Store(),
    service = base(store);
  try {
    const a = await service.saveKnowledge(policy("a")),
      b = await service.saveKnowledge(policy("b"));
    assert.ok(a && b);
    const results = await Promise.allSettled([
      service.saveKnowledge(policy("a", ["b"]), a.revision),
      service.saveKnowledge(policy("b", ["a"]), b.revision),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    const graph = policyGraph(await store.list<KnowledgeEntry>("knowledge"));
    assert.ok(
      !(
        graph.policies.get("a")!.data.dependsOn?.includes("b") &&
        graph.policies.get("b")!.data.dependsOn?.includes("a")
      ),
    );
  } finally {
    await store.close();
  }
});

test("기준 정책에서 의존 정책의 PRD·하위 태스크·이슈를 집계하고 직접 범위·방향·권한을 지킨다", async () => {
  const store = new Store(),
    service = base(store);
  try {
    await service.saveProject({
      id: "p",
      name: "제품",
      goal: "",
      repositories: ["org/repo"],
    });
    await service.saveProject({
      id: "private",
      name: "비공개 제품",
      goal: "",
      repositories: ["private/repo"],
    });
    await service.saveKnowledge(policy("upstream"));
    await service.saveKnowledge(policy("base", ["upstream"]));
    await service.saveKnowledge(policy("refund", ["base"]));
    await service.saveKnowledge(policy("extra", ["base"]));
    await service.saveKnowledge(policy("return", ["refund", "extra"]));
    const requirements = [];
    for (const id of ["upstream", "base", "refund", "return"])
      requirements.push(
        (await service.saveRequirement({
          id: `prd-${id}`,
          project: "p",
          featureName: id,
          policyIds: [id],
        }))!,
      );
    await service.saveRequirement({
      id: "private-prd",
      project: "private",
      featureName: "비공개 요구사항",
      policyIds: ["return"],
    });
    const converted = await service.convertRequirements({
      entries: requirements
        .filter((r) => ["base", "return"].includes(r.data.featureName))
        .map((r) => ({ id: r.data.id, revision: r.revision })),
    });
    const root = converted.results.find((r) => r.id === "prd-return")!.task;
    await service.saveTask({
      id: "child",
      project: "p",
      parentId: root,
      title: "하위 작업",
    });
    const issue: GitHubItem = {
      id: "org/repo#1",
      repository: "org/repo",
      number: 1,
      kind: "issue",
      title: "공유 이슈",
      body: "원본 보존",
      author: "dev",
      assignees: [],
      reviewers: [],
      state: "open",
      url: "https://github.com/org/repo/issues/1",
      updatedAt: "2026-11-01T00:00:00Z",
    };
    await store.save("github", issue.id, issue, "seed");
    await service.linkTask("child", issue.id);
    await service.linkTask(
      converted.results.find((r) => r.id === "prd-base")!.task,
      issue.id,
    );
    const reader = new Service(store, {
      name: "reader",
      role: "read",
      repositories: ["org/repo"],
    });
    const result = await reader.getKnowledgeImpact({ id: "base" });
    assert.deepEqual(result.summary, {
      requirements: 3,
      tasks: 3,
      issues: 1,
      prs: 0,
      policies: 3,
      projects: 1,
    });
    const indirect = result.page.items.find((r) => r.id === "prd-return")!;
    const ids = indirect.references[0]!.policyPath!.map((r) => r.id);
    assert.equal(ids[0], "return");
    assert.ok(["refund", "extra"].includes(ids[1]!));
    assert.equal(ids[2], "base");
    assert.equal(indirect.references[0]!.policyDistance, 2);
    assert.deepEqual(
      result.policyRelations!.dependencies.map((r) => r.id),
      ["upstream"],
    );
    assert.equal(result.policyRelations!.dependentCount, 3);
    assert.equal(
      (await reader.getKnowledgeImpact({ id: "base", scope: "direct" })).summary
        .requirements,
      1,
    );
    assert.equal(
      (await reader.getKnowledgeImpact({ id: "return" })).summary.requirements,
      1,
    );
    const issues = await reader.getKnowledgeImpact({
      id: "base",
      kind: "issues",
    });
    assert.equal(issues.page.items.length, 1);
    assert.equal(issues.page.items[0]!.referenceCount, 2);
    const policies = await reader.getKnowledgeImpact({
      id: "base",
      kind: "policies",
      project: "p",
      limit: 1,
    });
    assert.equal(policies.page.total, 2);
    assert.equal(policies.page.hasMore, true);
    assert.ok(!JSON.stringify(result).includes("비공개 요구사항"));
    assert.ok(!result.page.items.some((r) => r.id === "prd-upstream"));
    await assert.rejects(
      reader.getKnowledgeImpact({ id: "base", project: "private" }),
      { status: 404 },
    );
    const saved = await store.get<KnowledgeEntry>("knowledge", "base");
    await service.saveKnowledge(
      { ...policy("base", ["upstream"]), content: "변경된 기준" },
      saved!.revision,
    );
    assert.equal(
      (await reader.getKnowledgeImpact({ id: "base" })).document.revision,
      2,
    );
    assert.equal(
      (await store.get<GitHubItem>("github", issue.id))!.data.body,
      "원본 보존",
    );
  } finally {
    await store.close();
  }
});

test("MCP로 정책 연결을 수정하고 읽기 토큰으로 간접 PRD·정책을 조회한다", async () => {
  const store = new Store(),
    service = base(store);
  const server = createMcpServer(service),
    client = new Client({ name: "policy-dependency-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const readServer = createMcpServer(
    new Service(store, { name: "reader", role: "read" }),
  );
  const readClient = new Client({
    name: "policy-dependency-reader",
    version: "1",
  });
  try {
    await server.connect(a);
    await client.connect(b);
    const call = async (
      name: string,
      args: Record<string, unknown>,
      target = client,
    ) => {
      const response = await target.callTool({ name, arguments: args });
      assert.notEqual(response.isError, true, JSON.stringify(response));
      return JSON.parse((response.content as { text: string }[])[0]!.text);
    };
    const root = await call("save_knowledge", { data: policy("base") });
    const child = await call("save_knowledge", { data: policy("child") });
    await call("update_knowledge_fields", {
      id: "child",
      revision: child.revision,
      patch: { dependsOn: ["base"] },
    });
    await call("create_project", {
      id: "p",
      name: "검증 제품",
      goal: "",
      repositories: [],
    });
    await call("save_requirement", {
      data: {
        id: "r",
        project: "p",
        featureName: "도입",
        policyIds: ["child"],
      },
    });
    assert.equal(
      (
        await client.callTool({
          name: "update_knowledge_fields",
          arguments: {
            id: "base",
            revision: root.revision,
            patch: { dependsOn: ["child"] },
          },
        })
      ).isError,
      true,
    );
    const [c, d] = InMemoryTransport.createLinkedPair();
    await readServer.connect(c);
    await readClient.connect(d);
    assert.ok(
      !(await readClient.listTools()).tools.some(
        (r) => r.name === "save_knowledge",
      ),
    );
    const result = await call(
      "get_knowledge_impact",
      {
        id: "base",
        kind: "policies",
      },
      readClient,
    );
    assert.equal(result.page.items[0].id, "child");
    assert.equal(result.page.items[0].policyDistance, 1);
    assert.equal(
      (await call("get_knowledge_impact", { id: "base" }, readClient)).page
        .total,
      1,
    );
    assert.equal(
      (
        await call(
          "get_knowledge_impact",
          {
            id: "base",
            kind: "policies",
            scope: "direct",
          },
          readClient,
        )
      ).page.total,
      0,
    );
  } finally {
    await client.close();
    await server.close();
    await readClient.close();
    await readServer.close();
    await store.close();
  }
});

test("긴 정책 체인과 과거 순환 데이터도 반복 탐색하며 근거 경로 크기를 제한한다", () => {
  const rows: Stored<KnowledgeEntry>[] = Array.from(
    { length: 1500 },
    (_, n) => ({
      data: {
        ...knowledgeInput.parse(policy(`p${n}`, n ? [`p${n - 1}`] : [])),
        editor: "pm",
      },
      revision: 1,
      updatedAt: "2026-11-01T00:00:00Z",
    }),
  );
  const graph = policyGraph(rows),
    found = policyDependents(graph, "p0");
  const path = policyPath(graph, found, "p1499", "p0");
  assert.equal(found.size, 1500);
  assert.equal(path.policyDistance, 1499);
  assert.equal(path.policyPath.length, 8);
  assert.equal(path.policyPath.at(-1)!.id, "p0");
  assert.equal(path.policyPathTruncated, true);
  rows[0]!.data.dependsOn = ["p1499"];
  assert.equal(policyDependents(policyGraph(rows), "p0").size, 1500);
});
