import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  knowledgeImpact,
  knowledgeImpactQuery,
  type KnowledgeImpactData,
} from "../src/core/knowledge-impact";
import {
  knowledgeInput,
  type KnowledgeEntry,
} from "../src/core/knowledge-model";
import {
  requirementInput,
  type Requirement,
  type IssuePublication,
} from "../src/core/requirement-model";
import {
  taskSchema,
  type Stored,
  type Project,
  type GitHubItem,
} from "../src/core/model";
import type { Link } from "../src/core/service";
import { Service } from "../src/core/service";
import { Store } from "../src/db/store";
import { createMcpServer } from "../src/mcp/server";

const stored = <T>(data: T): Stored<T> => ({
  data,
  revision: 1,
  updatedAt: "2026-11-01T10:00:00Z",
});
const document = stored<KnowledgeEntry>({
  ...knowledgeInput.parse({
    id: "policy",
    kind: "policy",
    name: "보안 정책",
    content: "명시적 참조",
  }),
  editor: "pm",
});
const requirement = (
  id: string,
  project = "p",
  taskId: string | null = "root",
): Stored<Requirement> =>
  stored({
    ...requirementInput.parse({
      id,
      project,
      featureName: `기능 ${id}`,
      policyIds: ["policy"],
    }),
    taskId,
    featureId: null,
    number: 1,
    editor: "pm",
  });
const item = (
  id: string,
  kind: "issue" | "pr",
  number: number,
): Stored<GitHubItem> =>
  stored({
    id,
    repository: "Org/Repo",
    number,
    kind,
    title: id,
    body: "PRIVATE BODY MUST NOT BE RETURNED",
    author: "dev",
    assignees: ["dev"],
    reviewers: [],
    state: "open",
    url: `https://github.com/Org/Repo/${kind === "pr" ? "pull" : "issues"}/${number}`,
    updatedAt: "2026-11-03T10:00:00Z",
    files: [
      {
        path: "a",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: "PRIVATE PATCH",
      },
    ],
  });
const link = (
  task: string,
  item: string,
  status: Link["status"] = "approved",
) =>
  stored<Link>({
    id: `${task}-${item}-${status}`,
    task,
    item,
    status,
    method: "manual",
    reason: "직접 지정",
  });
function fixture(): KnowledgeImpactData {
  return {
    knowledge: [document],
    projects: [
      stored<Project>({
        id: "p",
        name: "공개",
        goal: "",
        featurePrefix: "PUBLI",
        repositories: ["org/repo"],
      }),
      stored<Project>({
        id: "q",
        name: "다른 프로젝트",
        goal: "",
        featurePrefix: "OTHER",
        repositories: ["private/repo"],
      }),
    ],
    requirements: [
      requirement("r1"),
      requirement("r2"),
      requirement("r3", "q", "other"),
    ],
    tasks: [
      stored(taskSchema.parse({ id: "root", project: "p", title: "부모" })),
      stored(
        taskSchema.parse({
          id: "child",
          project: "p",
          parentId: "root",
          title: "자식",
        }),
      ),
      stored(
        taskSchema.parse({
          id: "grandchild",
          project: "p",
          parentId: "child",
          title: "손자",
        }),
      ),
      stored(
        taskSchema.parse({
          id: "other",
          project: "q",
          parentId: "root",
          title: "다른 프로젝트 작업",
        }),
      ),
    ],
    items: [
      item("issue1", "issue", 1),
      item("pr2", "pr", 2),
      item("unapproved3", "issue", 3),
      item("private4", "issue", 4),
    ],
    links: [
      link("root", "issue1"),
      link("child", "issue1"),
      link("grandchild", "pr2"),
      link("root", "unapproved3", "suggested"),
      link("child", "unapproved3", "rejected"),
      link("other", "private4"),
    ],
    requirementIssues: [],
  };
}

test("명시적 PRD 참조·하위 작업·승인 연결을 집계하고 중복 이슈와 연결 근거를 합친다", () => {
  const data = fixture();
  const result = knowledgeImpact(
    document,
    data,
    knowledgeImpactQuery.parse({ id: "policy", project: "p", kind: "issues" }),
  );
  assert.deepEqual(result.summary, {
    requirements: 2,
    tasks: 3,
    issues: 1,
    prs: 1,
    policies: 0,
    projects: 1,
  });
  assert.equal(result.projects.length, 2);
  assert.equal(result.page.items[0]!.referenceCount, 4);
  assert.ok(result.page.items[0]!.references.some((r) => r.via === "subtask"));
  assert.ok(
    result.page.items[0]!.references.some((r) => r.label === "PUBLI-001"),
  );
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  const term = stored<KnowledgeEntry>({
    ...document.data,
    id: "term",
    kind: "glossary",
  });
  data.requirements[0]!.data.glossaryIds = ["term"];
  const terms = knowledgeImpact(
    term,
    data,
    knowledgeImpactQuery.parse({ id: "term" }),
  );
  assert.equal(terms.summary.requirements, 1);
  data.requirements[0]!.data.glossaryIds = [];
  data.requirements[0]!.data.description = "term 보안 정책 이름만 언급";
  assert.equal(
    knowledgeImpact(term, data, knowledgeImpactQuery.parse({ id: "term" }))
      .summary.requirements,
    0,
  );
});

test("캐시 없는 발행 이슈는 상태 미수집으로 표시하고 실패·다른 프로젝트 발행은 제외한다", () => {
  const data = fixture();
  const publication = (
    id: string,
    number: number,
    patch: Partial<IssuePublication> = {},
  ) =>
    stored<IssuePublication>({
      id,
      requirement: "r1",
      project: "p",
      task: "root",
      repository: "org/repo",
      state: "created",
      number,
      url: `https://github.com/org/repo/issues/${number}`,
      ...patch,
    });
  data.requirementIssues = [
    publication("same", 1),
    publication("missing", 9),
    publication("failed", 10, { state: "failed" }),
    publication("mismatch", 11, { project: "q" }),
  ];
  const result = knowledgeImpact(
    document,
    data,
    knowledgeImpactQuery.parse({ id: "policy", kind: "issues", project: "p" }),
  );
  assert.equal(result.summary.issues, 2);
  assert.equal(result.page.items.find((r) => r.number === 1)!.status, "open");
  const missing = result.page.items.find((r) => r.number === 9)!;
  assert.equal(missing.status, "unknown");
  assert.equal(missing.references[0]!.via, "published_issue");
});

test("페이지·순환 참조·대량 근거를 제한하고 문서나 연결 원본을 변경하지 않는다", () => {
  const data = fixture();
  data.tasks[0]!.data.parentId = "grandchild";
  data.requirements = Array.from({ length: 47 }, (_, n) =>
    requirement(`r-${String(n).padStart(2, "0")}`),
  );
  const before = JSON.stringify({ document, data });
  const result = knowledgeImpact(
    document,
    data,
    knowledgeImpactQuery.parse({ id: "policy", limit: 40 }),
  );
  assert.equal(result.page.items.length, 40);
  assert.equal(result.page.total, 47);
  assert.equal(result.page.nextOffset, 40);
  const second = knowledgeImpact(
    document,
    data,
    knowledgeImpactQuery.parse({ id: "policy", offset: 40 }),
  );
  assert.equal(second.page.items.length, 7);
  assert.equal(second.page.hasMore, false);
  const issues = knowledgeImpact(
    document,
    data,
    knowledgeImpactQuery.parse({ id: "policy", kind: "issues" }),
  );
  const issue = issues.page.items.find((r) => r.number === 1)!;
  assert.equal(issue.references.length, 5);
  assert.equal(issue.referenceCount, 94);
  assert.equal(JSON.stringify({ document, data }), before);
  for (const input of [
    { id: "policy", limit: 101 },
    { id: "policy", offset: -1 },
    { id: "policy", kind: "all" },
    { id: "../policy" },
  ])
    assert.equal(knowledgeImpactQuery.safeParse(input).success, false);
});

test("Service와 읽기 전용 MCP가 프로젝트·과거 발행 저장소·워크스페이스 권한을 지킨다", async () => {
  const store = new Store();
  let client: Client | undefined;
  let server: ReturnType<typeof createMcpServer> | undefined;
  try {
    const data = fixture();
    data.items[3]!.data.repository = "private/repo";
    await store.save("knowledge", document.data.id, document.data, "pm");
    for (const [kind, rows] of Object.entries({
      project: data.projects,
      requirement: data.requirements,
      task: data.tasks,
      github: data.items,
      link: data.links,
    }))
      for (const row of rows)
        await store.save(kind, row.data.id, row.data, "pm");
    await store.save(
      "requirement-issue",
      "old-private",
      {
        id: "old-private",
        requirement: "r1",
        project: "p",
        task: "root",
        repository: "private/repo",
        state: "created",
        number: 99,
        url: "https://github.com/private/repo/issues/99",
      },
      "pm",
    );
    const service = new Service(store, {
      name: "reader",
      role: "read",
      repositories: ["org/repo"],
    });
    const impact = await service.getKnowledgeImpact({
      id: "policy",
      kind: "issues",
    });
    assert.deepEqual(impact.summary, {
      requirements: 2,
      tasks: 3,
      issues: 1,
      prs: 1,
      policies: 0,
      projects: 1,
    });
    assert.ok(!JSON.stringify(impact).includes("private"));
    await assert.rejects(
      service.getKnowledgeImpact({ id: "policy", project: "q" }),
      { status: 404 },
    );
    await assert.rejects(service.getKnowledgeImpact({ id: "missing" }), {
      status: 404,
    });
    const other = new Service(store, {
      name: "reader",
      role: "read",
      workspaceId: "other",
    });
    await assert.rejects(other.getKnowledgeImpact({ id: "policy" }), {
      status: 404,
    });
    const eventsBefore = (
      await store.query<{ n: number }>("SELECT count(*)::int n FROM events")
    )[0]!.n;
    server = createMcpServer(service);
    client = new Client({ name: "impact-test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    const tools = await client.listTools();
    assert.equal(
      tools.tools.find((r) => r.name === "get_knowledge_impact")!.annotations
        ?.readOnlyHint,
      true,
    );
    assert.ok(!tools.tools.some((r) => r.name === "save_knowledge"));
    const response = await client.callTool({
      name: "get_knowledge_impact",
      arguments: { id: "policy", kind: "tasks", limit: 1 },
    });
    assert.notEqual(response.isError, true);
    const result = JSON.parse(
      (response.content as { text: string }[])[0]!.text,
    );
    assert.equal(result.summary.tasks, 3);
    assert.equal(result.page.items.length, 1);
    assert.equal(
      (
        await store.query<{ n: number }>("SELECT count(*)::int n FROM events")
      )[0]!.n,
      eventsBefore,
    );
  } finally {
    await client?.close();
    await server?.close();
    await store.close();
  }
});
