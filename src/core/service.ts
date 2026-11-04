import {
  pendingDependencies,
  validateDependencies,
  taskDependencyInfo,
} from "./dependencies";
import {
  Requirements,
  type Requirement,
  type IssuePublication,
} from "./requirements";
import { Collaboration, type TaskComment } from "./collaboration";
import { Workspaces } from "../workspaces/service";
import { knowledgeInput, type KnowledgeEntry } from "./knowledge-model";
import { knowledgeImpact, knowledgeImpactQuery } from "./knowledge-impact";
import { validatePolicyDependencies } from "./policy-dependencies";
import { changeHistory } from "./history";
import { acquireSyncLease } from "../jobs/lease";
import { SyncQueue } from "../jobs/queue";
import { analyze, suggest } from "../ai/analysis";
import { configuredProvider, type AIProvider } from "../ai/provider";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { Store } from "../db/store";
import {
  projectSchema,
  featureSchema,
  taskSchema,
  DomainError,
  type Actor,
  type Project,
  type Feature,
  type Task,
  type GitHubItem,
  type Stored,
} from "./model";
import { requireWrite, demoMode } from "./auth";
import { taskToday } from "./task-date";
import { asanaFileInput, asanaImportInput } from "./asana-file";
import { previewAsana, importAsana } from "./asana-import";
import {
  asanaProjectFileInput,
  asanaProjectImportInput,
  previewAsanaProject,
  importAsanaProject,
} from "./asana-project";
import { entityPatchInput, inputFields } from "./entity-patch";
import { requirementInput } from "./requirement-model";
import { deletionImpact } from "./deletion-preview";
import { parseTaskYaml, evaluateTask } from "../completion/index";
import { GitHubError, GitHubClient } from "../github/client";
import { serverGitHubClient } from "../github/server-client";
import { repositoryAssignees } from "../github/assignee-cache";
import { ensureProjectPrefixes, suggestProjectPrefix } from "./project-prefix";
import { cacheCompletionIndex } from "../github/changes";
import { GitHubRateLimitError } from "../github/rate-limit";
import { collectRepository } from "../github/items";
type TaskWriteContext = {
  tasks: Task[];
  byId: Map<string, Task>;
  stored: Map<string, Stored<Task>>;
  positions: Map<string, number>;
  features: Map<string, Stored<Feature>>;
  authorizedProjects: Set<string>;
};
export class Service {
  constructor(
    public store: Store,
    public actor: Actor,
    private github?: GitHubClient,
  ) {
    this.store = store.forWorkspace(actor.workspaceId ?? store.workspaceId);
  }
  private async withTaskGraph<T>(work: (service: Service) => Promise<T>) {
    return this.store.transaction(async (store) => {
      await store.query(
        "SELECT id FROM workspace_settings WHERE id=$1 FOR UPDATE",
        [store.workspaceId],
      );
      // 같은 작업 그래프의 수정·삭제를 직렬화해 동시 요청의 순환·끊어진 참조를 막는다.
      await store.query(
        "SELECT id FROM records WHERE workspace_id=$1 AND kind='project' ORDER BY id FOR UPDATE",
        [store.workspaceId],
      );
      await ensureProjectPrefixes(store);
      return work(new Service(store, this.actor, this.github));
    });
  }
  async saveKnowledge(input: unknown, revision?: number) {
    requireWrite(this.actor);
    const value = knowledgeInput.parse(input);
    return this.withTaskGraph(async (service) => {
      await service.store.query(
        "SELECT id FROM records WHERE workspace_id=$1 AND kind='knowledge' ORDER BY id FOR UPDATE",
        [service.store.workspaceId],
      );
      const documents = await service.store.list<KnowledgeEntry>("knowledge");
      const old = await service.store.get<KnowledgeEntry>(
        "knowledge",
        value.id,
      );
      if (old && old.data.kind !== value.kind)
        throw new DomainError("문서 종류는 변경할 수 없습니다.");
      if (
        value.kind === "glossary" &&
        documents.some(
          (r) =>
            r.data.id !== value.id &&
            r.data.kind === "glossary" &&
            r.data.name.toLowerCase() === value.name.toLowerCase(),
        )
      )
        throw new DomainError(
          "동일한 용어가 있습니다. 기존 항목을 편집하세요.",
          409,
        );
      return service.store.save(
        "knowledge",
        value.id,
        {
          ...value,
          dependsOn: validatePolicyDependencies(
            value,
            value.dependsOn ?? old?.data.dependsOn ?? [],
            documents,
          ),
          aliases: [...new Set(value.aliases)],
          editor: this.actor.name,
        },
        this.actor.name,
        revision,
      );
    });
  }
  async getKnowledgeImpact(input: unknown) {
    const query = knowledgeImpactQuery.parse(input);
    const document = await this.store.get<KnowledgeEntry>(
      "knowledge",
      query.id,
    );
    if (!document) throw new DomainError("문서가 없습니다.", 404);
    const data = await this.dashboard();
    if (
      query.project &&
      !data.projects.some((r) => r.data.id === query.project)
    )
      throw new DomainError("프로젝트가 없거나 접근할 수 없습니다.", 404);
    const allowed = this.actor.repositories
      ? new Set(this.actor.repositories.map((r) => r.toLowerCase()))
      : null;
    return knowledgeImpact(
      document,
      {
        ...data,
        requirementIssues: data.requirementIssues.filter(
          (r) => !allowed || allowed.has(r.data.repository.toLowerCase()),
        ),
      },
      query,
    );
  }
  async deleteKnowledge(input: unknown) {
    requireWrite(this.actor);
    const entry = z
      .strictObject({ id: z.string(), revision: z.number().int().positive() })
      .parse(input);
    return this.withTaskGraph(async (service) => {
      await service.store.query(
        "SELECT id FROM records WHERE workspace_id=$1 AND kind='knowledge' ORDER BY id FOR UPDATE",
        [service.store.workspaceId],
      );
      if (!(await service.store.get("knowledge", entry.id)))
        throw new DomainError("문서가 없습니다.", 404);
      if (
        (await service.store.list<KnowledgeEntry>("knowledge")).some(
          (r) =>
            r.data.id !== entry.id &&
            r.data.kind === "policy" &&
            r.data.dependsOn?.includes(entry.id),
        )
      )
        throw new DomainError(
          "다른 정책이 의존하는 문서입니다. 정책 연결을 해제하거나 사용 중단 상태로 관리하세요.",
        );
      if (
        (await service.store.list<Requirement>("requirement")).some((r) =>
          [...(r.data.policyIds ?? []), ...(r.data.glossaryIds ?? [])].includes(
            entry.id,
          ),
        )
      )
        throw new DomainError(
          "PRD에서 참조 중인 항목입니다. 참조를 해제하거나 사용 중단 상태로 관리하세요.",
        );
      await service.store.removeMany(
        [{ kind: "knowledge", ...entry }],
        this.actor.name,
      );
      return { removed: 1 };
    });
  }
  private requirements() {
    return new Requirements(this.store, this.actor);
  }
  async saveRequirement(input: unknown, revision?: number) {
    requireWrite(this.actor);
    return this.withTaskGraph((service) =>
      service.requirements().save(input, revision),
    );
  }
  async previewRequirementCsv(input: unknown) {
    return this.requirements().previewCsv(input);
  }
  async importRequirementCsv(input: unknown) {
    requireWrite(this.actor);
    return this.withTaskGraph((service) =>
      service.requirements().importCsv(input),
    );
  }
  async deleteRequirements(input: unknown) {
    requireWrite(this.actor);
    return this.withTaskGraph((service) =>
      service.requirements().remove(input),
    );
  }
  async convertRequirements(input: unknown) {
    requireWrite(this.actor);
    return this.withTaskGraph((service) =>
      service.requirements().convert(
        input,
        (task) => service.saveTaskUnlocked(task),
        (feature) => service.saveFeatureUnlocked(feature),
      ),
    );
  }
  async previewRequirementIssue(input: unknown) {
    const preview = await this.requirements().preview(input);
    return {
      repository: preview.repository,
      title: preview.title,
      body: preview.body,
      previewHash: preview.previewHash,
      assignee: preview.assignee,
    };
  }
  async publishRequirementIssue(input: unknown) {
    requireWrite(this.actor);
    if (demoMode())
      throw new DomainError("데모에서는 실제 GitHub 이슈를 생성하지 않습니다.");
    if (
      !this.github &&
      !this.actor.githubToken &&
      !this.actor.githubTokenProvider
    )
      throw new DomainError(
        "이슈 생성에는 개인 또는 워크스페이스 GitHub 연결이 필요합니다.",
        403,
      );
    return this.requirements().publish(
      input,
      this.github ?? serverGitHubClient(this.actor),
    );
  }
  async taskDependencies(taskId: string) {
    const tasks = (await this.dashboard()).tasks.map((r) => r.data);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new DomainError("태스크 접근 권한이 없습니다.", 403);
    return taskDependencyInfo(task, tasks);
  }
  private collaboration() {
    return new Collaboration(
      this.store,
      this.actor,
      async () => (await this.dashboard()).tasks,
    );
  }
  async listComments(task: string) {
    return this.collaboration().listComments(task);
  }
  async saveComment(input: unknown) {
    return this.collaboration().saveComment(input);
  }
  async deleteComment(input: unknown) {
    return this.collaboration().deleteComment(input);
  }
  async listNotifications() {
    return this.collaboration().listNotifications();
  }
  async readNotification(input: unknown) {
    return this.collaboration().readNotification(input);
  }
  async listWorkspaces() {
    if (!this.actor.userId)
      throw new DomainError("개인 사용자 인증이 필요합니다.", 401);
    return new Workspaces(this.store, this.actor.userId).list();
  }
  async createWorkspace(input: unknown) {
    requireWrite(this.actor);
    if (!this.actor.userId)
      throw new DomainError("개인 사용자 인증이 필요합니다.", 401);
    return new Workspaces(this.store, this.actor.userId).create(input);
  }
  async githubItem(input: string) {
    const key = z
      .string()
      .max(300)
      .regex(/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+#[1-9][0-9]*$/)
      .parse(input)
      .toLowerCase();
    const item = await this.store.get<GitHubItem>("github", key);
    if (
      !item ||
      (this.actor.repositories &&
        !this.actor.repositories.some(
          (repo) => repo.toLowerCase() === item.data.repository.toLowerCase(),
        ))
    )
      throw new DomainError("GitHub 항목을 찾을 수 없습니다.", 404);
    return item.data;
  }
  async listGitHubAssignees(input: unknown) {
    const { project, repository } = z
      .strictObject({ project: z.string(), repository: z.string().optional() })
      .parse(input);
    const row = await this.assertProject(project);
    if (repository && !row.data.repositories.includes(repository.toLowerCase()))
      throw new DomainError("프로젝트에 연결된 저장소를 선택하세요.", 403);
    const scope = row.data.repositories.length
      ? ("project" as const)
      : ("workspace" as const);
    const repositories = repository
      ? [repository.toLowerCase()]
      : row.data.repositories.length
        ? row.data.repositories
        : (this.actor.repositories ?? []);
    if (demoMode())
      return {
        users: [
          "demo-developer",
          "pm-developer",
          "test-manager",
          "minjun",
          "sujin",
        ].map((login) => ({ login, repositories })),
        repositories,
        scope,
      };
    if (!repositories.length) return { users: [], repositories: [], scope };
    if (
      !this.github &&
      this.actor.userId &&
      !this.actor.githubToken &&
      !this.actor.githubTokenProvider
    )
      throw new DomainError(
        "관리자가 워크스페이스 GitHub 연결을 설정해야 합니다.",
        403,
      );
    const client = this.github ?? serverGitHubClient(this.actor);
    const people = new Map<string, { login: string; repositories: string[] }>();
    let cursor = 0;
    try {
      await Promise.all(
        Array.from({ length: Math.min(3, repositories.length) }, async () => {
          while (cursor < repositories.length) {
            const repo = repositories[cursor++]!;
            for (const user of await repositoryAssignees(
              client,
              repo,
              this.github
                ? undefined
                : (this.actor.githubToken ??
                    (!this.actor.userId
                      ? process.env.GITHUB_TOKEN
                      : undefined)),
            )) {
              const key = user.login.toLowerCase();
              const entry = people.get(key) ?? {
                login: user.login,
                repositories: [],
              };
              entry.repositories.push(repo);
              people.set(key, entry);
            }
          }
        }),
      );
    } catch (error) {
      if (error instanceof GitHubRateLimitError) throw error;
      console.error("github_assignees_failed", {
        name: error instanceof Error ? error.name : "unknown",
        message:
          error instanceof Error ? error.message.slice(0, 240) : "unknown",
        cause:
          error instanceof Error &&
          error.cause &&
          typeof error.cause === "object" &&
          "code" in error.cause
            ? String(error.cause.code)
            : undefined,
      });
      throw new DomainError(
        "GitHub 담당자 목록을 불러오지 못했습니다. 연결과 저장소의 Issues 읽기 권한을 확인한 뒤 다시 시도하세요.",
        502,
      );
    }
    return {
      users: [...people.values()].sort((a, b) =>
        a.login.localeCompare(b.login),
      ),
      repositories,
      scope,
    };
  }
  async dashboard() {
    const missingPrefix = await this.store.query<{ missing: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM records WHERE workspace_id=$1 AND kind='project' AND NOT (data ? '_deleted') AND NOT (data ? 'featurePrefix')) AS missing",
      [this.store.workspaceId],
    );
    if (missingPrefix[0]?.missing) await this.withTaskGraph(async () => {});
    let [
      projects,
      features,
      tasks,
      items,
      syncs,
      links,
      repositories,
      activeSync,
      requirements,
      requirementIssues,
      knowledge,
    ] = await Promise.all([
      this.store.list<Project>("project"),
      this.store.list<Feature>("feature"),
      this.store.list<Task>("task"),
      this.store.list<GitHubItem>("github", { excludeGitHubFiles: true }),
      this.store.list<SyncRun>("sync"),
      this.store.list<Link>("link"),
      this.store.list<{ name: string }>("repository"),
      this.store.query(
        "SELECT name FROM sync_leases WHERE name='github-sync' AND expires_at>now()",
      ),
      this.store.list<Requirement>("requirement"),
      this.store.list<IssuePublication>("requirement-issue"),
      this.store.list<KnowledgeEntry>("knowledge"),
    ]);
    if (this.actor.repositories) {
      const allowed = new Set(this.actor.repositories);
      projects = projects.filter((p) =>
        p.data.repositories.every((r) => allowed.has(r.toLowerCase())),
      );
      const visibleProjects = new Set(projects.map((p) => p.data.id));
      requirements = requirements.filter((r) =>
        visibleProjects.has(r.data.project),
      );
      requirementIssues = requirementIssues.filter((r) =>
        visibleProjects.has(r.data.project),
      );
      features = features.filter((f) => visibleProjects.has(f.data.project));
      tasks = tasks.filter((t) => visibleProjects.has(t.data.project));
      items = items.filter((i) => allowed.has(i.data.repository.toLowerCase()));
      const taskIds = new Set(tasks.map((t) => t.data.id)),
        itemIds = new Set(items.map((i) => i.data.id));
      links = links.filter(
        (l) => taskIds.has(l.data.task) && itemIds.has(l.data.item),
      );
      repositories = repositories.filter((r) =>
        allowed.has(r.data.name.toLowerCase()),
      );
      syncs = syncs.filter((s) => s.data.userId === this.actor.userId);
    }
    const now = taskToday();
    const taskValues = tasks.map((row) => row.data);
    const attention = tasks.flatMap((t) => {
      const d = t.data;
      if (d.status === "done" || d.status === "canceled") return [];
      const reasons = [];
      if (!d.assignee) reasons.push("담당자 미지정");
      if (d.blockedReason) reasons.push(d.blockedReason);
      const pending = pendingDependencies(d, taskValues);
      if (pending.length)
        reasons.push(
          `선행 작업 미완료: ${pending.map((p) => p.id).join(", ")}`,
        );
      if (d.dueDate && d.dueDate < now) reasons.push("기한 초과");
      const linked = links
        .filter((l) => l.data.task === d.id && l.data.status === "approved")
        .map((l) => items.find((i) => i.data.id === l.data.item)?.data);
      if (linked.some((i) => i?.ci?.state === "failure"))
        reasons.push("연결 PR의 CI 실패");
      if (linked.some((i) => i?.state === "open" && i.reviewers.length))
        reasons.push("연결 PR 리뷰 요청 대기");
      return reasons.length ? [{ task: d.id, title: d.title, reasons }] : [];
    });
    return {
      viewer: {
        login: this.actor.name,
        userId: this.actor.userId ?? null,
        workspaceId: this.store.workspaceId,
        workspaceRole: this.actor.workspaceRole ?? null,
        role: this.actor.role,
      },
      mode: demoMode() ? "demo" : "live",
      syncInProgress: activeSync.length > 0,
      projects,
      repositories,
      collection: { since: process.env.GITHUB_SYNC_SINCE ?? null },
      features,
      requirements,
      requirementIssues,
      knowledge,
      tasks,
      items,
      syncs: syncs.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)),
      links,
      attention,
      briefing: {
        type: "rule-based",
        text: `태스크 ${tasks.length}개 중 ${tasks.filter((t) => t.data.status === "done").length}개 완료, 확인 필요 ${attention.length}개입니다.`,
        generatedAt: new Date().toISOString(),
      },
    };
  }
  private canProject(project: Project) {
    return (
      !this.actor.repositories ||
      project.repositories.every((r) =>
        this.actor.repositories!.includes(r.toLowerCase()),
      )
    );
  }
  private async assertProject(projectId: string) {
    const project = await this.store.get<Project>("project", projectId);
    if (!project || !this.canProject(project.data))
      throw new DomainError("프로젝트 접근 권한이 없습니다.", 403);
    return project;
  }
  async saveProject(input: unknown, revision?: number) {
    requireWrite(this.actor);
    return this.withTaskGraph((service) =>
      service.saveProjectUnlocked(input, revision),
    );
  }
  private async saveProjectUnlocked(input: unknown, revision?: number) {
    requireWrite(this.actor);
    const p = projectSchema.parse(input);
    if (p.startDate && p.endDate && p.startDate > p.endDate)
      throw new DomainError("종료일은 시작일 이후여야 합니다.");
    p.repositories = [...new Set(p.repositories.map((r) => r.toLowerCase()))];
    if (!this.canProject(p))
      throw new DomainError("접근 가능한 저장소만 연결할 수 있습니다.", 403);
    const existing = await this.store.get<Project>("project", p.id);
    if (existing) {
      await this.assertProject(p.id);
      if (existing.data.repositories.length && !p.repositories.length)
        throw new DomainError(
          "저장소 기반 프로젝트의 마지막 연결은 제거할 수 없습니다. 저장소 없는 외부 프로젝트는 별도로 가져오세요.",
        );
    }
    const org = process.env.GITHUB_ORG;
    if (
      org &&
      p.repositories.some(
        (r) => r.split("/")[0]?.toLowerCase() !== org.toLowerCase(),
      )
    )
      throw new DomainError("설정한 조직의 저장소만 등록할 수 있습니다.");
    const otherPrefixes = (await this.store.list<Project>("project"))
      .filter((row) => row.data.id !== p.id)
      .flatMap((row) =>
        row.data.featurePrefix ? [row.data.featurePrefix] : [],
      );
    p.featurePrefix =
      p.featurePrefix ??
      existing?.data.featurePrefix ??
      suggestProjectPrefix(p.name, p.id, otherPrefixes);
    if (otherPrefixes.includes(p.featurePrefix))
      throw new DomainError(
        "다른 프로젝트에서 사용 중인 기능 식별자입니다. 다른 5자리를 입력하세요.",
        409,
      );
    return this.store.save("project", p.id, p, this.actor.name, revision);
  }
  async saveFeature(input: unknown, revision?: number) {
    requireWrite(this.actor);
    return this.withTaskGraph((service) =>
      service.saveFeatureUnlocked(input, revision),
    );
  }
  private async saveFeatureUnlocked(input: unknown, revision?: number) {
    requireWrite(this.actor);
    const f = featureSchema.parse(input);
    await this.assertProject(f.project);
    const old = await this.store.get<Feature>("feature", f.id);
    if (old) {
      f.acceptanceCriteria ??= old.data.acceptanceCriteria;
      await this.assertProject(old.data.project);
      if (
        old.data.project !== f.project &&
        (await this.store.list<Task>("task")).some(
          (t) => t.data.feature === f.id,
        )
      )
        throw new DomainError(
          "태스크가 있는 기능의 프로젝트는 변경할 수 없습니다.",
        );
    }
    if (!(await this.store.get("project", f.project)))
      throw new DomainError("프로젝트가 없습니다.");
    return this.store.save("feature", f.id, f, this.actor.name, revision);
  }
  async migrateWorkItems() {
    requireWrite(this.actor);
    return this.withTaskGraph(async (service) => {
      const dashboard = await service.dashboard();
      let created = 0;
      for (const { data: feature } of dashboard.features) {
        if (feature.name === "작업" && feature.id.startsWith("work-")) continue;
        if (dashboard.tasks.some((row) => row.data.feature === feature.id))
          continue;
        const taskId = `work-${createHash("sha256").update(`legacy:${feature.id}`).digest("hex").slice(0, 24)}`;
        if (await service.store.get("work-migration", feature.id)) continue;
        if (await service.store.get("task", taskId)) continue;
        await service.saveTaskUnlocked({
          id: taskId,
          project: feature.project,
          feature: feature.id,
          title: feature.name,
          description: [
            feature.goal,
            feature.acceptanceCriteria
              ? `## 인수 기준\n${feature.acceptanceCriteria}`
              : "",
          ]
            .filter(Boolean)
            .join("\n\n")
            .slice(0, 8000),
        });
        await service.store.save(
          "work-migration",
          feature.id,
          { task: taskId },
          service.actor.name,
        );
        created++;
      }
      return { created };
    });
  }
  async saveTask(input: unknown, revision?: number) {
    requireWrite(this.actor);
    return this.withTaskGraph((service) =>
      service.saveTaskUnlocked(input, revision),
    );
  }
  async previewAsanaFile(input: unknown) {
    requireWrite(this.actor);
    const data = asanaFileInput.parse(input);
    await this.assertProject(data.project);
    return previewAsana(this.store, data);
  }
  async previewAsanaProject(input: unknown) {
    requireWrite(this.actor);
    const data = asanaProjectFileInput.parse(input);
    return previewAsanaProject(this.store, data, (id) =>
      this.assertProject(id),
    );
  }
  async importAsanaProject(input: unknown) {
    requireWrite(this.actor);
    const data = asanaProjectImportInput.parse(input);
    return this.withTaskGraph(async (service) => {
      const saveTask = await service.asanaTaskWriter();
      return importAsanaProject(
        service.store,
        service.actor.name,
        data,
        (id) => service.assertProject(id),
        (value, revision) => service.saveProject(value, revision),
        saveTask,
      );
    });
  }
  async importAsanaFile(input: unknown) {
    requireWrite(this.actor);
    const data = asanaImportInput.parse(input);
    return this.withTaskGraph(async (service) => {
      await service.assertProject(data.project);
      const saveTask = await service.asanaTaskWriter();
      return importAsana(service.store, service.actor.name, data, saveTask);
    });
  }
  private async asanaTaskWriter() {
    // withTaskGraph의 잠금 안에서만 사용하고, 저장 결과를 즉시 반영한다.
    const [tasks, features] = await Promise.all([
      this.store.list<Task>("task"),
      this.store.list<Feature>("feature"),
    ]);
    const context: TaskWriteContext = {
      tasks: tasks.map((row) => row.data),
      byId: new Map(tasks.map((row) => [row.data.id, row.data])),
      stored: new Map(tasks.map((row) => [row.data.id, row])),
      positions: new Map(tasks.map((row, index) => [row.data.id, index])),
      features: new Map(features.map((row) => [row.data.id, row])),
      authorizedProjects: new Set(),
    };
    return (value: unknown, revision?: number) =>
      this.saveTaskUnlocked(value, revision, context);
  }
  private async saveTaskUnlocked(
    input: unknown,
    revision?: number,
    context?: TaskWriteContext,
  ) {
    requireWrite(this.actor);
    const t = taskSchema.parse(input);
    const assertProject = async (project: string) => {
      if (!context?.authorizedProjects.has(project)) {
        await this.assertProject(project);
        context?.authorizedProjects.add(project);
      }
    };
    const getTask = (id: string) =>
      context ? context.stored.get(id) : this.store.get<Task>("task", id);
    const getFeature = (id: string) =>
      context
        ? context.features.get(id)
        : this.store.get<Feature>("feature", id);
    await assertProject(t.project);
    const previous = await getTask(t.id);
    if (!t.feature) {
      const parent = t.parentId ? await getTask(t.parentId) : null;
      t.feature =
        previous?.data.feature ??
        parent?.data.feature ??
        `work-${createHash("sha256").update(t.project).digest("hex").slice(0, 24)}`;
      if (!(await getFeature(t.feature))) {
        const feature = await this.saveFeatureUnlocked({
          id: t.feature,
          project: t.project,
          name: "작업",
          goal: "",
        });
        if (feature) context?.features.set(t.feature, feature);
      }
    }
    const f = await getFeature(t.feature);
    if (!f || f.data.project !== t.project)
      throw new DomainError("프로젝트에 속한 기능을 선택하세요.");
    const existing = previous;
    if (existing) await assertProject(existing.data.project);
    t.type ??= existing?.data.type ?? "feature";
    if (t.parentId === undefined) t.parentId = existing?.data.parentId ?? null;
    const allTasks =
      context?.tasks ??
      (await this.store.list<Task>("task")).map((row) => row.data);
    t.dependsOn = [...new Set(t.dependsOn ?? existing?.data.dependsOn ?? [])];
    validateDependencies(t, allTasks, context?.byId);
    const byId =
      context?.byId ?? new Map(allTasks.map((task) => [task.id, task]));
    const seen = new Set([t.id]);
    let parentId = t.parentId;
    while (parentId) {
      if (seen.has(parentId))
        throw new DomainError("상위 태스크를 순환 연결할 수 없습니다.");
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (
        !parent ||
        parent.project !== t.project ||
        parent.feature !== t.feature
      )
        throw new DomainError("같은 프로젝트·기능의 상위 태스크를 선택하세요.");
      parentId = parent.parentId ?? null;
    }
    if (
      allTasks.some(
        (child) =>
          child.parentId === t.id &&
          (child.project !== t.project || child.feature !== t.feature),
      )
    )
      throw new DomainError(
        "하위 태스크가 있는 작업은 프로젝트·기능을 변경할 수 없습니다.",
      );
    if (t.yaml) {
      const definition = parseTaskYaml(t.yaml);
      if (
        definition.task !== t.id ||
        definition.project !== t.project ||
        definition.feature !== t.feature
      )
        throw new DomainError("YAML과 태스크의 식별자가 일치해야 합니다.");
    }
    const saved = await this.store.save(
      "task",
      t.id,
      t,
      this.actor.name,
      revision,
    );
    if (saved && context) {
      const position = context.positions.get(t.id);
      if (position === undefined) {
        context.positions.set(t.id, context.tasks.length);
        context.tasks.push(saved.data);
      } else context.tasks[position] = saved.data;
      context.stored.set(t.id, saved);
      context.byId.set(t.id, saved.data);
    }
    return saved;
  }
  async bulkUpdate(input: unknown) {
    requireWrite(this.actor);
    const data = z
      .object({
        kind: z.enum(["project", "feature", "task"]),
        entries: z
          .array(
            z.object({ id: z.string(), revision: z.number().int().positive() }),
          )
          .min(1)
          .max(100),
        patch: z.record(z.string(), z.unknown()),
      })
      .parse(input);
    const allowed =
      data.kind === "project"
        ? ["startDate", "endDate", "goal"]
        : data.kind === "feature"
          ? ["goal"]
          : ["assignee", "priority", "dueDate", "status"];
    if (
      !Object.keys(data.patch).length ||
      Object.keys(data.patch).some((key) => !allowed.includes(key))
    )
      throw new DomainError("일괄 수정 필드를 확인하세요.");
    const dashboard = await this.dashboard();
    const rows =
      data.kind === "project"
        ? dashboard.projects
        : data.kind === "feature"
          ? dashboard.features
          : dashboard.tasks;
    // 모든 입력과 접근 범위를 먼저 검증한다. 동시 변경은 항목별 revision으로 검출한다.
    const prepared = data.entries.map((entry) => {
      const row = rows.find((r) => r.data.id === entry.id);
      if (!row) throw new DomainError("항목 접근 권한이 없습니다.", 403);
      if (row.revision !== entry.revision)
        throw new DomainError("다른 요청이 변경했습니다. 새로고침하세요.", 409);
      const schema =
        data.kind === "project"
          ? projectSchema
          : data.kind === "feature"
            ? featureSchema
            : taskSchema;
      const value = schema.parse({ ...row.data, ...data.patch });
      if (
        "startDate" in value &&
        value.startDate &&
        value.endDate &&
        value.startDate > value.endDate
      )
        throw new DomainError("종료일은 시작일 이후여야 합니다.");
      return { entry, value };
    });
    const results = [];
    for (const { entry, value } of prepared) {
      try {
        if (data.kind === "project")
          await this.saveProject(value, entry.revision);
        else if (data.kind === "feature")
          await this.saveFeature(value, entry.revision);
        else await this.saveTask(value, entry.revision);
        results.push({ id: entry.id, ok: true });
      } catch (error) {
        results.push({
          id: entry.id,
          ok: false,
          error: error instanceof DomainError ? error.message : "수정 실패",
        });
      }
    }
    return { results };
  }
  async removeEntities(input: unknown) {
    requireWrite(this.actor);
    return this.withTaskGraph((service) =>
      service.removeEntitiesUnlocked(input),
    );
  }
  async previewEntityDeletion(input: unknown) {
    const { kind, ids } = z
      .strictObject({
        kind: z.enum(["project", "feature", "task"]),
        ids: z.array(z.string()).min(1).max(100),
      })
      .parse(input);
    const data = await this.dashboard();
    const rows =
      kind === "project"
        ? data.projects
        : kind === "feature"
          ? data.features
          : data.tasks;
    if (ids.some((id) => !rows.some((row) => row.data.id === id)))
      throw new DomainError("항목이 없거나 접근할 수 없습니다.", 404);
    return {
      kind,
      ids,
      ...deletionImpact(data, kind, ids),
      reversible: false,
      githubOriginalsChanged: false,
    };
  }
  async patchEntity(input: unknown) {
    requireWrite(this.actor);
    const value = entityPatchInput.parse(input);
    const data = await this.dashboard();
    const rows =
      value.kind === "project"
        ? data.projects
        : value.kind === "task"
          ? data.tasks
          : value.kind === "requirement"
            ? data.requirements
            : data.knowledge;
    const old = rows.find((row) => row.data.id === value.id);
    if (!old) throw new DomainError("항목이 없거나 접근할 수 없습니다.", 404);
    if (old.revision !== value.revision)
      throw new DomainError(
        "다른 요청이 변경했습니다. 다시 조회한 뒤 수정하세요.",
        409,
      );
    const schema =
      value.kind === "project"
        ? projectSchema
        : value.kind === "task"
          ? taskSchema
          : value.kind === "requirement"
            ? requirementInput
            : knowledgeInput;
    const merged = { ...inputFields(schema, old.data), ...value.patch };
    if (value.kind === "project")
      return this.saveProject(merged, value.revision);
    if (value.kind === "task") return this.saveTask(merged, value.revision);
    if (value.kind === "requirement")
      return this.saveRequirement(merged, value.revision);
    return this.saveKnowledge(merged, value.revision);
  }
  private async removeEntitiesUnlocked(input: unknown) {
    requireWrite(this.actor);
    const { kind, entries } = z
      .object({
        kind: z.enum(["project", "feature", "task"]),
        entries: z
          .array(
            z.object({ id: z.string(), revision: z.number().int().positive() }),
          )
          .min(1)
          .max(100),
      })
      .parse(input);
    const dashboard = await this.dashboard();
    const rows =
      kind === "project"
        ? dashboard.projects
        : kind === "feature"
          ? dashboard.features
          : dashboard.tasks;
    for (const entry of entries) {
      const row = rows.find((r) => r.data.id === entry.id);
      if (!row) throw new DomainError("항목 접근 권한이 없습니다.", 403);
      if (row.revision !== entry.revision)
        throw new DomainError("다른 요청이 변경했습니다. 새로고침하세요.", 409);
    }
    const ids = entries.map((e) => e.id);
    const taskIds = dashboard.tasks
      .filter((t) =>
        kind === "task"
          ? ids.includes(t.data.id)
          : kind === "project"
            ? ids.includes(t.data.project)
            : ids.includes(t.data.feature),
      )
      .map((t) => t.data.id);
    if (kind === "task") {
      let added = true;
      while (added) {
        added = false;
        for (const row of dashboard.tasks) {
          if (
            row.data.parentId &&
            taskIds.includes(row.data.parentId) &&
            !taskIds.includes(row.data.id)
          ) {
            taskIds.push(row.data.id);
            added = true;
          }
        }
      }
    }
    if (
      dashboard.tasks.some(
        (row) =>
          !taskIds.includes(row.data.id) &&
          row.data.dependsOn?.some((id) => taskIds.includes(id)),
      )
    )
      throw new DomainError(
        "다른 태스크가 선행 작업으로 참조 중입니다. 의존관계를 해제하거나 관련 작업을 함께 선택해 삭제하세요.",
      );
    if (
      dashboard.requirementIssues.some(
        (r) =>
          r.data.state === "publishing" &&
          ((kind === "project" && ids.includes(r.data.project)) ||
            taskIds.includes(r.data.task)),
      )
    )
      throw new DomainError(
        "GitHub 이슈를 생성 중인 항목은 잠시 후 삭제하세요.",
        409,
      );
    const targets = [
      ...entries.map((e) => ({ kind, id: e.id, revision: e.revision })),
      ...(kind === "project"
        ? dashboard.features
            .filter((f) => ids.includes(f.data.project))
            .map((f) => ({
              kind: "feature",
              id: f.data.id,
              revision: f.revision,
            }))
        : []),
      ...(kind === "project"
        ? (await this.store.list<Requirement>("requirement"))
            .filter((r) => ids.includes(r.data.project))
            .map((r) => ({
              kind: "requirement",
              id: r.data.id,
              revision: r.revision,
            }))
        : []),
      ...(kind === "project"
        ? (await this.store.list<IssuePublication>("requirement-issue"))
            .filter((r) => ids.includes(r.data.project))
            .map((r) => ({
              kind: "requirement-issue",
              id: r.data.id,
              revision: r.revision,
            }))
        : []),
      ...dashboard.tasks
        .filter(
          (t) =>
            taskIds.includes(t.data.id) &&
            !(kind === "task" && ids.includes(t.data.id)),
        )
        .map((t) => ({ kind: "task", id: t.data.id, revision: t.revision })),
      ...(await this.store.list<TaskComment>("comment"))
        .filter((r) => taskIds.includes(r.data.task))
        .map((r) => ({ kind: "comment", id: r.data.id, revision: r.revision })),
      ...dashboard.links
        .filter((l) => taskIds.includes(l.data.task))
        .map((l) => ({ kind: "link", id: l.data.id, revision: l.revision })),
    ];
    await this.store.removeMany(targets, this.actor.name);
    return { removed: entries.length };
  }
  async importItems(input: unknown) {
    requireWrite(this.actor);
    const data = z
      .object({
        project: z.string(),
        feature: z.string().optional(),
        items: z.array(z.string()).min(1).max(100),
      })
      .parse(input);
    const project = await this.assertProject(data.project);
    const feature = data.feature
      ? await this.store.get<Feature>("feature", data.feature)
      : null;
    if (data.feature && (!feature || feature.data.project !== data.project))
      throw new DomainError("프로젝트에 속한 기능을 선택하세요.");
    const dashboard = await this.dashboard();
    const items = [...new Set(data.items)].map(
      (id) => dashboard.items.find((i) => i.data.id === id)?.data,
    );
    if (
      items.some(
        (i) =>
          !i || !project.data.repositories.includes(i.repository.toLowerCase()),
      )
    )
      throw new DomainError(
        "프로젝트 저장소에 속한 항목만 추가할 수 있습니다.",
      );
    let created = 0,
      skipped = 0;
    for (const item of items as GitHubItem[]) {
      const existing = dashboard.links.find(
        (l) =>
          l.data.item === item.id &&
          l.data.status === "approved" &&
          dashboard.tasks.some(
            (t) =>
              t.data.id === l.data.task &&
              t.data.project === data.project &&
              (!data.feature || t.data.feature === data.feature),
          ),
      );
      if (existing) {
        skipped++;
        continue;
      }
      const id = `task-${randomUUID()}`;
      await this.saveTask({
        id,
        project: data.project,
        feature: data.feature,
        title: item.title,
        description: item.body.slice(0, 8000),
        assignee: item.assignees[0] ?? item.author,
        status:
          item.kind === "pr" && item.state === "open" ? "in_review" : "backlog",
      });
      await this.linkTask(id, item.id);
      created++;
    }
    return { created, skipped };
  }
  async suggestLinks(taskId: string) {
    requireWrite(this.actor);
    const t = await this.store.get<Task>("task", taskId);
    if (!t) throw new DomainError("태스크가 없습니다.", 404);
    const project = await this.assertProject(t.data.project);
    const items = await this.store.list<GitHubItem>("github");
    const tokens = t.data.title
      .toLowerCase()
      .split(/\s+/)
      .filter((v) => v.length >= 2);
    const suggestions = [];
    for (const { data: item } of items) {
      if (!project?.data.repositories.includes(item.repository)) continue;
      const matched = tokens.filter((v) =>
        `${item.title} ${item.body}`.toLowerCase().includes(v),
      );
      if (!matched.length) continue;
      const key = `${taskId}:${item.id}`;
      const old = await this.store.get<Link>("link", key);
      if (old) continue;
      const link: Link = {
        id: key,
        task: taskId,
        item: item.id,
        status: "suggested",
        reason: `제목 키워드 일치: ${matched.join(", ")}`,
        method: "keyword",
      };
      await this.store.save("link", key, link, this.actor.name);
      suggestions.push(link);
    }
    return suggestions;
  }
  async decideLink(
    id: string,
    status: "approved" | "rejected",
    revision: number,
  ) {
    requireWrite(this.actor);
    const l = await this.store.get<Link>("link", id);
    if (!l) throw new DomainError("연결 후보가 없습니다.", 404);
    const task = await this.store.get<Task>("task", l.data.task);
    if (!task) throw new DomainError("태스크가 없습니다.", 404);
    await this.assertProject(task.data.project);
    return this.store.save(
      "link",
      id,
      { ...l.data, status },
      this.actor.name,
      revision,
    );
  }
  async analyzeProject(projectId: string, provider?: AIProvider) {
    requireWrite(this.actor);
    if (demoMode())
      throw new DomainError(
        "데모 모드에서는 외부 AI 분석을 실행하지 않습니다.",
      );
    const project = await this.assertProject(projectId);
    if (!project) throw new DomainError("프로젝트가 없습니다.", 404);
    const tasks = (await this.store.list<Task>("task"))
      .filter((t) => t.data.project === projectId)
      .map((t) => t.data);
    const items = (await this.store.list<GitHubItem>("github"))
      .filter((i) => project.data.repositories.includes(i.data.repository))
      .map((i) => i.data);
    const output = await analyze(
      provider ?? configuredProvider(),
      tasks,
      items,
    );
    await this.store.save(
      "analysis",
      randomUUID(),
      { project: projectId, ...output },
      this.actor.name,
    );
    return output;
  }
  async aiSuggestLinks(taskId: string, provider?: AIProvider) {
    requireWrite(this.actor);
    if (demoMode())
      throw new DomainError(
        "데모 모드에서는 외부 AI 분석을 실행하지 않습니다.",
      );
    const task = await this.store.get<Task>("task", taskId);
    if (!task) throw new DomainError("태스크가 없습니다.", 404);
    const project = await this.assertProject(task.data.project);
    const items = (await this.store.list<GitHubItem>("github"))
      .filter((i) => project?.data.repositories.includes(i.data.repository))
      .map((i) => i.data);
    const candidates = await suggest(
      provider ?? configuredProvider(),
      task.data,
      items,
    );
    const saved = [];
    for (const candidate of candidates) {
      const key = `${taskId}:${candidate.item}`;
      if (await this.store.get("link", key)) continue;
      const link: Link = {
        id: key,
        task: taskId,
        item: candidate.item,
        status: "suggested",
        reason: candidate.reason,
        method: "ai",
      };
      await this.store.save("link", key, link, this.actor.name);
      saved.push(link);
    }
    return saved;
  }
  async linkTask(taskId: string, itemId: string) {
    requireWrite(this.actor);
    const task = await this.store.get<Task>("task", taskId);
    const item = await this.store.get<GitHubItem>("github", itemId);
    if (!task || !item)
      throw new DomainError("태스크 또는 GitHub 항목이 없습니다.", 404);
    const p = await this.assertProject(task.data.project);
    if (!p?.data.repositories.includes(item.data.repository))
      throw new DomainError("프로젝트 범위 밖의 항목입니다.");
    const key = `${taskId}:${itemId}`;
    return this.store.upsert(
      "link",
      key,
      {
        id: key,
        task: taskId,
        item: itemId,
        status: "approved",
        reason: "사용자가 직접 연결",
        method: "manual",
      },
      this.actor.name,
    );
  }
  async history() {
    return changeHistory(this.store, this.actor, await this.dashboard());
  }
  async listSyncJobs() {
    const jobs = await new SyncQueue(this.store).list();
    return this.actor.repositories
      ? jobs.filter((j) => this.actor.repositories!.includes(j.repository))
      : jobs;
  }
  async retrySyncJob(id: string) {
    requireWrite(this.actor);
    if (
      this.actor.repositories &&
      !(await this.listSyncJobs()).some((j) => j.id === id)
    )
      throw new DomainError("작업 접근 권한이 없습니다.", 403);
    if (!(await new SyncQueue(this.store).retry(id)))
      throw new DomainError("재시도할 실패 작업이 없습니다.", 409);
    return { accepted: true };
  }
  async sync(options: { repositories?: string[]; project?: string } = {}) {
    if (options.project) {
      const project = await this.assertProject(options.project);
      if (!project.data.repositories.length)
        throw new DomainError(
          "프로젝트에 GitHub 저장소를 연결한 뒤 동기화하세요.",
        );
      options = { ...options, repositories: project.data.repositories };
    }
    requireWrite(this.actor);
    if (
      this.actor.userId &&
      !this.actor.githubToken &&
      !this.actor.githubTokenProvider &&
      !this.github
    )
      throw new DomainError(
        "관리자가 워크스페이스 GitHub 연결을 설정해야 합니다.",
        403,
      );
    if (demoMode())
      throw new DomainError(
        "데모 모드에서는 실제 GitHub 동기화를 실행하지 않습니다.",
      );
    if (!process.env.GITHUB_ORG)
      throw new DomainError("GITHUB_ORG를 설정하세요.");
    const requested = options.repositories
      ? z
          .array(
            z.string().regex(/^[A-Za-z0-9_-]+\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/),
          )
          .min(1)
          .max(100)
          .parse(options.repositories)
          .map((r) => r.toLowerCase())
      : undefined;
    if (
      requested?.some(
        (r) => r.split("/")[0] !== process.env.GITHUB_ORG!.toLowerCase(),
      )
    )
      throw new DomainError("설정한 조직의 저장소만 동기화할 수 있습니다.");
    const since = process.env.GITHUB_SYNC_SINCE
      ? z.iso.datetime({ offset: true }).parse(process.env.GITHUB_SYNC_SINCE)
      : undefined;
    const lease = await acquireSyncLease(this.store);
    const run = {
      id: randomUUID(),
      startedAt: new Date().toISOString(),
      finishedAt: "",
      errors: [] as string[],
      warnings: [] as string[],
      scope: requested ?? null,
      userId: this.actor.userId,
      since: since ?? null,
      repositories: 0,
    };
    try {
      const client = this.github ?? serverGitHubClient(this.actor);
      const available = z
        .array(z.object({ full_name: z.string() }))
        .parse(
          await client.listOrganizationRepositories(process.env.GITHUB_ORG),
        );
      const allRepositories = [
        ...new Set(available.map((r) => r.full_name.toLowerCase())),
      ];
      if (
        requested?.some(
          (repo) =>
            this.actor.repositories && !this.actor.repositories.includes(repo),
        )
      )
        throw new DomainError(
          "접근 가능한 저장소만 동기화할 수 있습니다.",
          403,
        );
      const targets = requested
        ? [...new Set(requested)]
        : allRepositories.filter(
            (repo) =>
              !this.actor.repositories ||
              this.actor.repositories.includes(repo),
          );
      for (const repo of available) {
        await lease.check();
        await this.store.upsert(
          "repository",
          repo.full_name,
          { name: repo.full_name },
          this.actor.name,
        );
      }
      for (const repo of targets) {
        if (
          !available.some(
            (r) => r.full_name.toLowerCase() === repo.toLowerCase(),
          )
        ) {
          run.errors.push(`${repo}: 조직에서 접근 가능한 저장소가 아닙니다.`);
          continue;
        }
        try {
          const items = await collectRepository(client, repo, { since });
          for (const item of items) {
            await lease.check();
            await this.store.upsert("github", item.id, item, this.actor.name);
            if (
              item.kind === "pr" &&
              item.baseBranch &&
              item.mergedAt !== undefined
            )
              await this.store.upsert(
                "pr-snapshot",
                item.id,
                {
                  state: item.state === "open" ? "open" : "closed",
                  mergedAt: item.mergedAt,
                  targetBranch: item.baseBranch,
                  observedAt: new Date().toISOString(),
                },
                this.actor.name,
              );
          }
          run.repositories++;
        } catch (error) {
          if (error instanceof GitHubRateLimitError) throw error;
          run.errors.push(`${repo}: PR·이슈 수집 실패 (이전 데이터 유지)`);
        }
      }
      const loaded = [];
      // 완료 조건은 다른 저장소에 있을 수 있어 조직 전체 설정을 다시 확인한다.
      for (const repo of allRepositories) {
        try {
          const index = await client.loadTasks(repo);
          await cacheCompletionIndex(this.store, index);
          loaded.push(index);
        } catch (error) {
          if (error instanceof GitHubRateLimitError) throw error;
          if (error instanceof GitHubError && error.status === 404)
            run.warnings.push(`${repo}: YAML 설정 경로 없음 또는 접근 불가`);
          else run.errors.push(`${repo}: YAML 조회 실패`);
        }
      }
      const counts = new Map<string, number>();
      for (const l of loaded)
        for (const t of l.tasks)
          counts.set(
            t.definition.task,
            (counts.get(t.definition.task) ?? 0) + 1,
          );
      const workspaceIds =
        !this.actor.userId && !this.actor.workspaceId
          ? [
              ...new Set([
                "main",
                ...(
                  await this.store.query<{ id: string }>(
                    "SELECT id FROM workspace_settings",
                  )
                ).map((w) => w.id),
              ]),
            ]
          : [this.store.workspaceId];
      const evaluationStores = workspaceIds.map((id) =>
        this.store.forWorkspace(id),
      );
      for (const evaluationStore of evaluationStores) {
        const projects = (
          await evaluationStore.list<Project>("project")
        ).filter((p) => this.canProject(p.data));
        for (const l of loaded) {
          run.errors.push(
            ...l.errors.map((e) => `${l.repository}/${e.path}: ${e.message}`),
          );
          for (const config of l.tasks) {
            const d = config.definition;
            if (counts.get(d.task)! > 1) {
              run.errors.push(`${d.task}: 저장소 간 중복 설정`);
              continue;
            }
            const task = await evaluationStore.get<Task>("task", d.task);
            if (!task && evaluationStores.length > 1) continue;
            if (
              !task ||
              task.data.project !== d.project ||
              task.data.feature !== d.feature
            ) {
              run.errors.push(
                `${d.task}: 등록된 태스크·프로젝트·기능과 불일치`,
              );
              continue;
            }
            const project = projects.find((p) => p.data.id === d.project);
            if (!project?.data.repositories.includes(l.repository)) {
              run.errors.push(`${d.task}: 프로젝트 외부의 설정 저장소`);
              continue;
            }
            const rules =
              "all" in d.completion ? d.completion.all : d.completion.any;
            if (
              rules.some(
                (r) =>
                  !project.data.repositories.includes(
                    r.pull_request.repository.toLowerCase(),
                  ),
              )
            ) {
              run.errors.push(`${d.task}: 프로젝트 범위 밖의 PR 조건`);
              continue;
            }
            const result = await evaluateTask(d, (repo, n) =>
              client.readPullRequest(repo, n),
            );
            await lease.check();
            if (result.state === "unknown")
              run.errors.push(`${d.task}: 완료 조건의 PR 조회 미확인`);
            await evaluationStore.save(
              "evaluation",
              randomUUID(),
              {
                ...result,
                source: config.source,
                evaluatedAt: new Date().toISOString(),
              },
              this.actor.name,
            );
            if (
              result.state === "satisfied" &&
              task.data.status !== "canceled" &&
              task.data.status !== "done"
            )
              await evaluationStore.save(
                "task",
                d.task,
                { ...task.data, status: "done" },
                this.actor.name,
                task.revision,
              );
          }
        }
      }
    } catch (error) {
      if (error instanceof GitHubRateLimitError) run.errors.push(error.message);
      else
        run.errors.push(
          "조직 동기화 실패. 인증과 GitHub API 상태를 확인하세요.",
        );
    } finally {
      run.finishedAt = new Date().toISOString();
      try {
        await this.store.save("sync", run.id, run, this.actor.name);
      } finally {
        await lease.close();
      }
    }
    return run;
  }
}
export interface Link {
  id: string;
  task: string;
  item: string;
  status: "suggested" | "approved" | "rejected";
  reason: string;
  method: "keyword" | "manual" | "ai";
}

export interface SyncRun {
  id: string;
  startedAt: string;
  finishedAt: string;
  errors: string[];
  repositories: number;
  warnings?: string[];
  scope?: string[] | null;
  userId?: string;
}
