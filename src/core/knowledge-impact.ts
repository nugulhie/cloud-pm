import { z } from "zod";
import {
  id,
  type GitHubItem,
  type Project,
  type Stored,
  type Task,
} from "./model";
import type { KnowledgeEntry } from "./knowledge-model";
import {
  requirementLabel,
  requirementTaskIds,
  type IssuePublication,
  type Requirement,
} from "./requirement-model";
import type { Link } from "./service";
import {
  policyGraph,
  policyDependents,
  policyPath,
} from "./policy-dependencies";

export const knowledgeImpactQuery = z.strictObject({
  id,
  kind: z
    .enum(["requirements", "tasks", "issues", "prs", "policies"])
    .default("requirements"),
  scope: z.enum(["all", "direct"]).default("all"),
  project: id.optional(),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .default(0),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});
export type ImpactKind = z.infer<typeof knowledgeImpactQuery>["kind"];
type ProjectRef = { id: string; name: string };
export type ImpactReference = {
  requirementId: string;
  label: string;
  title: string;
  project: ProjectRef;
  via: "prd" | "task" | "subtask" | "published_issue";
  taskId?: string;
} & Partial<ReturnType<typeof policyPath>>;
export type ImpactItem = {
  id: string;
  kind: ImpactKind;
  title: string;
  label: string;
  status: string;
  assignees: string[];
  updatedAt: string;
  projects: ProjectRef[];
  references: ImpactReference[];
  referenceCount: number;
  repository?: string;
  number?: number;
  url?: string;
} & Partial<ReturnType<typeof policyPath>>;
export type KnowledgeImpactData = {
  projects: Stored<Project>[];
  requirements: Stored<Requirement>[];
  tasks: Stored<Task>[];
  items: Stored<GitHubItem>[];
  links: Stored<Link>[];
  requirementIssues: Stored<IssuePublication>[];
  knowledge: Stored<KnowledgeEntry>[];
};
type Candidate = Omit<ImpactItem, "projects" | "references" | "referenceCount">;

// Input must already be scoped to the viewer's workspace and project permissions.
export function knowledgeImpact(
  document: Stored<KnowledgeEntry>,
  data: KnowledgeImpactData,
  query: z.infer<typeof knowledgeImpactQuery>,
) {
  const projects = new Map(data.projects.map((r) => [r.data.id, r.data]));
  const graph = policyGraph([...data.knowledge, document]);
  const dependents = policyDependents(graph, document.data.id);
  const included = new Set(
    query.scope === "all" && document.data.kind === "policy"
      ? dependents.keys()
      : [document.data.id],
  );
  const requirements = data.requirements.filter(
    (r) =>
      projects.has(r.data.project) &&
      (document.data.kind === "policy"
        ? r.data.policyIds
        : r.data.glossaryIds
      )?.some((id) => included.has(id)),
  );
  const options = [...new Set(requirements.map((r) => r.data.project))]
    .map((id) => ({ id, name: projects.get(id)!.name }))
    .sort(
      (a, b) => a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id),
    );
  const tasks = new Map(data.tasks.map((r) => [r.data.id, r]));
  const children = new Map<string, Stored<Task>[]>();
  for (const task of data.tasks) {
    if (!task.data.parentId) continue;
    const rows = children.get(task.data.parentId) ?? [];
    rows.push(task);
    children.set(task.data.parentId, rows);
  }
  const github = new Map(data.items.map((r) => [r.data.id, r]));
  const canonical = (kind: string, repository: string, number: number) =>
    `${kind}:${repository.toLowerCase()}#${number}`;
  const githubByNumber = new Map(
    data.items.map((r) => [
      canonical(r.data.kind, r.data.repository, r.data.number),
      r,
    ]),
  );
  const links = new Map<string, Stored<GitHubItem>[]>();
  for (const link of data.links) {
    const item = github.get(link.data.item);
    if (link.data.status !== "approved" || !item) continue;
    const rows = links.get(link.data.task) ?? [];
    rows.push(item);
    links.set(link.data.task, rows);
  }
  const publications = new Map<string, Stored<IssuePublication>[]>();
  for (const publication of data.requirementIssues) {
    const p = publication.data;
    if (
      p.state !== "created" ||
      !Number.isSafeInteger(p.number) ||
      p.number! < 1 ||
      !p.url
    )
      continue;
    const rows = publications.get(p.requirement) ?? [];
    rows.push(publication);
    publications.set(p.requirement, rows);
  }
  const found: Record<
    ImpactKind,
    Map<string, { item: Candidate; refs: Map<string, ImpactReference> }>
  > = {
    requirements: new Map(),
    tasks: new Map(),
    issues: new Map(),
    prs: new Map(),
    policies: new Map(),
  };
  function add(item: Candidate, ref?: ImpactReference) {
    let current = found[item.kind].get(item.id);
    if (!current) {
      current = { item, refs: new Map() };
      found[item.kind].set(item.id, current);
    }
    if (ref)
      current.refs.set(
        `${ref.requirementId}:${ref.taskId ?? ""}:${ref.via}:${ref.policyPath?.[0]?.id ?? ""}`,
        ref,
      );
  }
  function addPolicy(id: string, ref?: ImpactReference) {
    if (id === document.data.id) return;
    const row = graph.policies.get(id);
    if (!row) return;
    const evidence = policyPath(graph, dependents, id, document.data.id);
    add(
      {
        id,
        kind: "policies",
        title: row.data.name,
        label: evidence.policyDistance === 1 ? "직접 의존" : "간접 의존",
        status: row.data.status,
        assignees: row.data.owner ? [row.data.owner] : [],
        updatedAt: row.updatedAt,
        ...evidence,
      },
      ref,
    );
  }
  if (!query.project && document.data.kind === "policy")
    for (const id of included) addPolicy(id);
  function addGitHub(row: Stored<GitHubItem>, ref: ImpactReference) {
    const item = row.data;
    add(
      {
        id: canonical(item.kind, item.repository, item.number),
        kind: item.kind === "pr" ? "prs" : "issues",
        title: item.title,
        label: `${item.repository}#${item.number}`,
        status: item.state,
        assignees: item.assignees,
        updatedAt: item.updatedAt || row.updatedAt,
        repository: item.repository,
        number: item.number,
        url: item.url,
      },
      ref,
    );
  }
  for (const row of requirements) {
    const r = row.data;
    if (query.project && r.project !== query.project) continue;
    const project = projects.get(r.project)!;
    const matches: Array<string | undefined> =
      document.data.kind === "policy"
        ? [...new Set((r.policyIds ?? []).filter((id) => included.has(id)))]
        : [undefined];
    for (const policyId of matches) {
      const ref: ImpactReference = {
        requirementId: r.id,
        label: requirementLabel(r, project.featurePrefix),
        title: r.featureName,
        project: { id: project.id, name: project.name },
        via: "prd",
        ...(policyId
          ? policyPath(graph, dependents, policyId, document.data.id)
          : {}),
      };
      if (policyId) addPolicy(policyId, ref);
      add(
        {
          id: r.id,
          kind: "requirements",
          title: r.featureName,
          label: ref.label,
          status: r.status,
          assignees: r.assignee ? [r.assignee] : [],
          updatedAt: row.updatedAt,
        },
        ref,
      );
      const rootIds = new Set(requirementTaskIds(r));
      const queue = [...rootIds];
      const visited = new Set<string>();
      while (queue.length) {
        const taskId = queue.pop()!;
        if (visited.has(taskId)) continue;
        visited.add(taskId);
        const taskRow = tasks.get(taskId);
        if (!taskRow || taskRow.data.project !== r.project) continue;
        const task = taskRow.data;
        const taskRef: ImpactReference = {
          ...ref,
          taskId,
          via: rootIds.has(taskId) ? "task" : "subtask",
        };
        add(
          {
            id: taskId,
            kind: "tasks",
            title: task.title,
            label: "",
            status: task.status,
            assignees: task.assignee ? [task.assignee] : [],
            updatedAt: taskRow.updatedAt,
          },
          taskRef,
        );
        for (const item of links.get(taskId) ?? []) addGitHub(item, taskRef);
        for (const child of children.get(taskId) ?? [])
          queue.push(child.data.id);
      }
      for (const publication of publications.get(r.id) ?? []) {
        const p = publication.data;
        if (p.project !== r.project) continue;
        const publicationRef: ImpactReference = {
          ...ref,
          via: "published_issue",
        };
        const cached = githubByNumber.get(
          canonical("issue", p.repository, p.number!),
        );
        if (cached) addGitHub(cached, publicationRef);
        else
          add(
            {
              id: canonical("issue", p.repository, p.number!),
              kind: "issues",
              title: r.featureName,
              label: `${p.repository}#${p.number}`,
              status: "unknown",
              assignees: p.assignee ? [p.assignee] : [],
              updatedAt: publication.updatedAt,
              repository: p.repository,
              number: p.number,
              url: p.url,
            },
            publicationRef,
          );
      }
    }
  }
  const results = [...found[query.kind].values()].sort(
    (a, b) =>
      (Date.parse(b.item.updatedAt) || 0) -
        (Date.parse(a.item.updatedAt) || 0) ||
      a.item.id.localeCompare(b.item.id),
  );
  const items: ImpactItem[] = results
    .slice(query.offset, query.offset + query.limit)
    .map(({ item, refs }) => ({
      ...item,
      projects: [
        ...new Map(
          [...refs.values()].map((ref) => [ref.project.id, ref.project]),
        ).values(),
      ],
      references: [...refs.values()].slice(0, 5),
      referenceCount: refs.size,
    }));
  const summary = {
    requirements: found.requirements.size,
    tasks: found.tasks.size,
    issues: found.issues.size,
    prs: found.prs.size,
    policies: found.policies.size,
    projects: query.project
      ? found.requirements.size
        ? 1
        : 0
      : options.length,
  };
  return {
    document: {
      id: document.data.id,
      kind: document.data.kind,
      name: document.data.name,
      revision: document.revision,
      updatedAt: document.updatedAt,
    },
    summary,
    projects: options,
    kind: query.kind,
    project: query.project ?? null,
    scope: query.scope,
    policyRelations:
      document.data.kind === "policy"
        ? {
            dependencies: [...new Set(document.data.dependsOn ?? [])].flatMap(
              (id) => {
                const row = graph.policies.get(id);
                return row ? [{ id, name: row.data.name }] : [];
              },
            ),
            dependentCount: Math.max(0, dependents.size - 1),
          }
        : null,
    page: {
      items,
      total: results.length,
      offset: query.offset,
      limit: query.limit,
      hasMore: query.offset + items.length < results.length,
      nextOffset:
        query.offset + items.length < results.length
          ? query.offset + items.length
          : null,
    },
  };
}
export type KnowledgeImpact = ReturnType<typeof knowledgeImpact>;
