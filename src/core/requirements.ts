import {
  type Actor,
  type Task,
  type Project,
  type Stored,
  DomainError,
} from "./model";
import { requireWrite, demoMode } from "./auth";
import { createHash, randomUUID } from "node:crypto";
import {
  csvFileInput,
  csvImportInput,
  parseRequirementCsv,
  sourceKey,
} from "./requirement-csv";
import type { Store } from "../db/store";
import { GitHubRateLimitError } from "../github/rate-limit";
import { GitHubClient, GitHubError } from "../github/client";
import type { KnowledgeEntry } from "./knowledge-model";
import {
  requirementInput,
  requirementEntries,
  conversionInput,
  publishInput,
  requirementLabel,
  requirementBody,
  requirementTaskIds,
  type Requirement,
  type IssuePublication,
} from "./requirement-model";
export type { Requirement, IssuePublication } from "./requirement-model";

// 로컬 변경은 Service의 프로젝트 잠금 트랜잭션 안에서 실행한다.
export class Requirements {
  constructor(
    private store: Store,
    private actor: Actor,
  ) {}
  private async access(projectId: string) {
    const project = await this.store.get<Project>("project", projectId);
    if (
      !project ||
      (this.actor.repositories &&
        !project.data.repositories.every((repo) =>
          this.actor.repositories!.includes(repo.toLowerCase()),
        ))
    )
      throw new DomainError("프로젝트 접근 권한이 없습니다.", 403);
    return project;
  }
  private async row(id: string, revision: number) {
    const row = await this.store.get<Requirement>("requirement", id);
    if (!row) throw new DomainError("PRD 항목이 없습니다.", 404);
    await this.access(row.data.project);
    if (row.revision !== revision)
      throw new DomainError(
        "PRD가 변경되었습니다. 새로고침 후 다시 시도하세요.",
        409,
      );
    return row;
  }
  async save(
    input: unknown,
    revision?: number,
    source?: Requirement["source"],
  ) {
    requireWrite(this.actor);
    const value = requirementInput.parse(input);
    await this.access(value.project);
    const old = await this.store.get<Requirement>("requirement", value.id);
    if (old) {
      await this.access(old.data.project);
      if (old.data.project !== value.project)
        throw new DomainError("PRD의 프로젝트는 변경할 수 없습니다.");
    }
    value.sourceId = value.sourceId ?? old?.data.sourceId;
    if (
      value.sourceId &&
      (await this.store.list<Requirement>("requirement")).some(
        (r) =>
          r.data.id !== value.id &&
          r.data.project === value.project &&
          sourceKey(r.data.sourceId ?? "") === sourceKey(value.sourceId!),
      )
    )
      throw new DomainError("같은 프로젝트에 동일한 원본 ID가 있습니다.", 409);
    value.policyIds = [
      ...new Set(value.policyIds ?? old?.data.policyIds ?? []),
    ];
    value.glossaryIds = [
      ...new Set(value.glossaryIds ?? old?.data.glossaryIds ?? []),
    ];
    for (const [kind, ids] of [
      ["policy", value.policyIds],
      ["glossary", value.glossaryIds],
    ] as const) {
      for (const documentId of ids) {
        const document = await this.store.get<KnowledgeEntry>(
          "knowledge",
          documentId,
        );
        if (!document || document.data.kind !== kind)
          throw new DomainError("같은 워크스페이스의 정책·용어를 선택하세요.");
      }
    }
    const number =
      old?.data.number ??
      Math.max(
        0,
        ...(await this.store.list<Requirement>("requirement"))
          .filter((r) => r.data.project === value.project)
          .map((r) => r.data.number),
      ) + 1;
    // 삭제 후에도 번호는 재사용하지 않는다.
    const counter = old
      ? undefined
      : await this.store.get<{ number: number }>(
          "requirement-counter",
          value.project,
        );
    const next = old
      ? number
      : Math.max(number, (counter?.data.number ?? 0) + 1);
    const result = await this.store.save<Requirement>(
      "requirement",
      value.id,
      {
        ...value,
        number: next,
        editor: this.actor.name,
        featureId: old?.data.featureId ?? null,
        taskId: old?.data.taskId ?? null,
        taskIds: old ? requirementTaskIds(old.data) : [],
        ...((source ?? old?.data.source)
          ? { source: source ?? old?.data.source }
          : {}),
      },
      this.actor.name,
      revision,
    );
    if (!old)
      await this.store.save(
        "requirement-counter",
        value.project,
        { number: next },
        this.actor.name,
        counter?.revision,
      );
    return result;
  }
  async previewCsv(input: unknown) {
    requireWrite(this.actor);
    const file = csvFileInput.parse(input);
    await this.access(file.project);
    const parsed = parseRequirementCsv(file);
    const existing = (await this.store.list<Requirement>("requirement")).filter(
      (r) => r.data.project === file.project,
    );
    const rows = parsed.rows.map((row) => {
      const matches = existing.filter(
        (r) =>
          r.data.sourceId &&
          sourceKey(r.data.sourceId) === sourceKey(row.data.sourceId ?? ""),
      );
      return {
        ...row,
        errors:
          matches.length > 1
            ? [...row.errors, "등록된 항목의 원본 ID가 중복되어 있습니다."]
            : row.errors,
        existing: matches[0]
          ? { id: matches[0].data.id, revision: matches[0].revision }
          : null,
      };
    });
    const previewHash = createHash("sha256")
      .update(
        JSON.stringify({
          file,
          existing: rows.map((r) => ({ row: r.row, existing: r.existing })),
        }),
      )
      .digest("hex");
    return {
      ...file,
      csv: undefined,
      rows,
      warnings: parsed.warnings,
      fields: parsed.fields,
      sourceFields: parsed.sourceFields,
      counts: {
        total: rows.length,
        invalid: rows.filter((r) => r.errors.length).length,
        existing: rows.filter((r) => r.existing).length,
        new: rows.filter((r) => !r.existing).length,
      },
      previewHash,
    };
  }
  async importCsv(input: unknown) {
    requireWrite(this.actor);
    const data = csvImportInput.parse(input);
    const preview = await this.previewCsv({
      project: data.project,
      fileName: data.fileName,
      csv: data.csv,
    });
    if (preview.previewHash !== data.previewHash)
      throw new DomainError(
        "미리보기 이후 항목이 변경되었습니다. 파일을 다시 미리 확인하세요.",
        409,
      );
    if (preview.counts.invalid)
      throw new DomainError(
        "오류가 있는 행을 수정한 뒤 다시 올려주세요. 아무 항목도 등록하지 않았습니다.",
      );
    let created = 0,
      updated = 0,
      skipped = 0;
    for (const row of preview.rows) {
      if (row.existing && data.mode === "skip") {
        skipped++;
        continue;
      }
      const old = row.existing
        ? await this.store.get<Requirement>("requirement", row.existing.id)
        : undefined;
      const value: Record<string, unknown> = old
        ? Object.fromEntries(
            Object.entries(old.data).filter(([key]) =>
              Object.keys(requirementInput.shape).includes(key),
            ),
          )
        : { ...row.data, id: randomUUID() };
      for (const key of preview.fields)
        if (key in row.data)
          value[key] = (row.data as Record<string, unknown>)[key];
      value.project = data.project;
      const source = {
        ...row.source,
        editedAt: preview.sourceFields.includes("editedAt")
          ? row.source.editedAt
          : (old?.data.source?.editedAt ?? null),
        editor: preview.sourceFields.includes("sourceEditor")
          ? row.source.editor
          : (old?.data.source?.editor ?? ""),
      };
      await this.save(value, old?.revision, source);
      if (old) updated++;
      else created++;
    }
    return { created, updated, skipped };
  }
  async remove(input: unknown) {
    requireWrite(this.actor);
    const entries = requirementEntries.parse(input);
    if (new Set(entries.map((e) => e.id)).size !== entries.length)
      throw new DomainError("중복 항목을 확인하세요.");
    for (const entry of entries) {
      const row = await this.row(entry.id, entry.revision);
      if (
        (
          await Promise.all(
            requirementTaskIds(row.data).map((id) =>
              this.store.get("task", id),
            ),
          )
        ).some(Boolean)
      )
        throw new DomainError(
          "태스크로 전환된 PRD는 삭제할 수 없습니다. 보류 상태로 관리하세요.",
        );
      const publication = (
        await this.store.list<IssuePublication>("requirement-issue")
      ).find((p) => p.data.requirement === entry.id);
      if (publication)
        throw new DomainError(
          "GitHub 이슈 발행 이력이 있는 PRD는 보류 상태로 관리하세요.",
        );
    }
    await this.store.removeMany(
      entries.map((e) => ({ ...e, kind: "requirement" })),
      this.actor.name,
    );
    return { removed: entries.length };
  }
  async convert(
    input: unknown,
    saveTask: (task: unknown) => Promise<Stored<Task> | undefined>,
    saveFeature: (feature: unknown) => Promise<unknown>,
  ) {
    requireWrite(this.actor);
    const {
      entries,
      feature,
      tasks: requestedTasks,
    } = conversionInput.parse(input);
    if (new Set(entries.map((e) => e.id)).size !== entries.length)
      throw new DomainError("중복 항목을 확인하세요.");
    if (requestedTasks && entries.length !== 1)
      throw new DomainError(
        "태스크를 나누어 추가할 때는 PRD 하나를 선택하세요.",
      );
    if (
      requestedTasks &&
      new Set(requestedTasks.map((t) => t.id)).size !== requestedTasks.length
    )
      throw new DomainError("추가할 태스크 ID가 중복되었습니다.");
    const rows = [];
    for (const e of entries) rows.push(await this.row(e.id, e.revision));
    const results = [];
    for (const row of rows) {
      const projectPrefix = (await this.access(row.data.project)).data
        .featurePrefix;
      const linkedIds = requirementTaskIds(row.data);
      const existingTasks = (
        await Promise.all(
          linkedIds.map((id) => this.store.get<Task>("task", id)),
        )
      ).filter((t) => !!t && t.data.project === row.data.project);
      if (!requestedTasks && existingTasks.length) {
        results.push({
          id: row.data.id,
          task: existingTasks[0]!.data.id,
          tasks: existingTasks.map((t) => t!.data.id),
          created: false,
        });
        continue;
      }
      if (!requestedTasks && linkedIds.length)
        throw new DomainError(
          "연결 태스크가 삭제되었습니다. 새로운 PRD 항목으로 다시 등록하세요.",
        );
      let featureId = feature ?? row.data.featureId;
      if (
        !featureId ||
        (!feature && !(await this.store.get("feature", featureId)))
      ) {
        featureId = `prd-feature-${row.data.id}`;
        if (!(await this.store.get("feature", featureId)))
          await saveFeature({
            id: featureId,
            project: row.data.project,
            name: row.data.featureName,
            goal: row.data.description,
          });
      }
      const drafts = requestedTasks ?? [
        {
          id: `prd-task-${row.data.id}`,
          title: `[${requirementLabel(row.data, projectPrefix)}] ${row.data.featureName}`,
        },
      ];
      const createdIds: string[] = [];
      for (const draft of drafts) {
        const existing = await this.store.get<Task>("task", draft.id);
        if (existing) {
          if (
            !linkedIds.includes(draft.id) ||
            existing.data.project !== row.data.project
          )
            throw new DomainError(
              "이미 사용 중인 태스크 ID입니다. 새로운 ID로 다시 추가하세요.",
              409,
            );
          continue;
        }
        // 삭제된 태스크의 ID를 재사용하면 과거 이슈가 새 작업으로 연결될 수 있다.
        if (linkedIds.includes(draft.id))
          throw new DomainError(
            "삭제된 태스크의 ID는 재사용할 수 없습니다.",
            409,
          );
        await saveTask({
          id: draft.id,
          project: row.data.project,
          feature: featureId,
          title: draft.title,
          description:
            draft.description ??
            requirementBody(
              row.data,
              this.store.workspaceId,
              undefined,
              projectPrefix,
            ),
          assignee: draft.assignee ?? row.data.assignee,
          repository: draft.repository ?? null,
        });
        createdIds.push(draft.id);
      }
      const taskIds = [...new Set([...linkedIds, ...drafts.map((t) => t.id)])];
      if (!createdIds.length) {
        results.push({
          id: row.data.id,
          task: taskIds[0]!,
          tasks: taskIds,
          created: false,
          createdTasks: [],
        });
        continue;
      }
      await this.store.save(
        "requirement",
        row.data.id,
        {
          ...row.data,
          featureId,
          taskId: row.data.taskId ?? taskIds[0]!,
          taskIds,
          editor: this.actor.name,
        },
        this.actor.name,
        row.revision,
      );
      results.push({
        id: row.data.id,
        task: taskIds[0]!,
        tasks: taskIds,
        created: true,
        createdTasks: createdIds,
      });
    }
    return { results };
  }
  async preview(input: unknown) {
    const {
      id,
      revision,
      repository,
      previewHash,
      assignee: requestedAssignee,
      taskId: requestedTaskId,
    } = publishInput.parse(input);
    const row = await this.row(id, revision);
    const project = await this.access(row.data.project);
    const repo = repository.toLowerCase();
    if (!project.data.repositories.includes(repo))
      throw new DomainError("프로젝트에 연결된 저장소를 선택하세요.", 403);
    const ids = requirementTaskIds(row.data);
    if (requestedTaskId && !ids.includes(requestedTaskId))
      throw new DomainError("이 PRD에 연결된 태스크를 선택하세요.");
    if (!requestedTaskId && ids.length > 1)
      throw new DomainError(
        "여러 태스크 중 이슈를 생성할 태스크를 선택하세요.",
      );
    const taskId = requestedTaskId ?? ids[0];
    const task = taskId
      ? await this.store.get<Task>("task", taskId)
      : undefined;
    if (!task || task.data.project !== row.data.project)
      throw new DomainError("먼저 PRD를 태스크로 전환하세요.");
    if (task.data.repository && task.data.repository.toLowerCase() !== repo)
      throw new DomainError("태스크에 지정된 저장소를 선택하세요.");
    const assignee = requestedAssignee ?? task.data.assignee;
    if (assignee && !/^[A-Za-z0-9_-]{1,100}$/.test(assignee))
      throw new DomainError(
        "이슈 담당자를 GitHub 사용자 목록에서 다시 선택하세요.",
      );
    const references = [];
    for (const documentId of [
      ...(row.data.policyIds ?? []),
      ...(row.data.glossaryIds ?? []),
    ]) {
      const document = await this.store.get<KnowledgeEntry>(
        "knowledge",
        documentId,
      );
      if (document)
        references.push(
          `### ${document.data.kind === "policy" ? "관련 정책" : "관련 용어"}: ${document.data.name}\n\n${document.data.content.slice(0, 2000)}${document.data.content.length > 2000 ? "\n\n(2000자 발췌 · 원문은 워크스페이스 문서에서 확인)" : ""}\n\n문서 ID: ${documentId}`,
        );
    }
    const prefix = `[${requirementLabel(row.data, project.data.featurePrefix)}]`;
    const taskTitle = task.data.title.replace(
      /^\[(?:[A-Z0-9]{5}-\d+|PRD-\d+)\]\s*/,
      "",
    );
    const title = (
      task.data.title.startsWith(`${prefix} `)
        ? task.data.title
        : `${prefix} ${taskTitle}`
    ).slice(0, 300);
    const body = [
      requirementBody(
        { ...row.data, assignee },
        this.store.workspaceId,
        task.data,
        project.data.featurePrefix,
      ),
      ...references,
    ].join("\n\n");
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          repository: repo,
          title,
          body,
          assignee,
          taskRevision: task.revision,
        }),
      )
      .digest("hex");
    if (previewHash && previewHash !== hash)
      throw new DomainError(
        "PRD 또는 참조 문서가 변경되었습니다. 본문 미리보기를 다시 확인하세요.",
        409,
      );
    return {
      row,
      task,
      repository: repo,
      title,
      body,
      previewHash: hash,
      assignee,
    };
  }
  private async publication(row: Requirement, taskId: string) {
    const legacy = await this.store.get<IssuePublication>(
      "requirement-issue",
      row.id,
    );
    if (legacy?.data.task === taskId) return { id: row.id, prior: legacy };
    if (!legacy && row.taskId === taskId)
      return { id: row.id, prior: undefined };
    const key = `task-${createHash("sha256").update(`${row.id}:${taskId}`).digest("hex")}`;
    return {
      id: key,
      prior: await this.store.get<IssuePublication>("requirement-issue", key),
    };
  }
  async publish(input: unknown, client: GitHubClient) {
    requireWrite(this.actor);
    if (demoMode())
      throw new DomainError("데모에서는 실제 GitHub 이슈를 생성하지 않습니다.");
    const initial = await this.preview(input);
    const { prior: priorPublication } = await this.publication(
      initial.row.data,
      initial.task.data.id,
    );
    if (priorPublication?.data.state === "created") {
      if (priorPublication.data.repository !== initial.repository)
        throw new DomainError(
          "이 태스크는 다른 저장소에 이미 이슈가 있습니다. 다른 저장소의 작업은 새 태스크로 추가하세요.",
          409,
        );
      return priorPublication.data;
    }
    if (initial.assignee) {
      let assignable: boolean;
      try {
        assignable = await client.canAssign(
          initial.repository,
          initial.assignee,
        );
      } catch (error) {
        if (error instanceof GitHubRateLimitError) throw error;
        throw new DomainError(
          "GitHub 담당자 권한을 확인하지 못했습니다. 아직 이슈를 생성하지 않았습니다. 잠시 후 다시 시도하세요.",
          502,
        );
      }
      if (!assignable)
        throw new DomainError(
          "이 저장소에 배정할 수 없는 GitHub 사용자입니다. 담당자 목록을 새로고침하고 다시 선택하세요.",
        );
    }
    const prepared = await this.store.transaction(async (store) => {
      await store.query(
        "SELECT id FROM workspace_settings WHERE id=$1 FOR UPDATE",
        [store.workspaceId],
      );
      await store.query(
        "SELECT id FROM records WHERE workspace_id=$1 AND kind='project' ORDER BY id FOR UPDATE",
        [store.workspaceId],
      );
      const snapshot = await new Requirements(store, this.actor).preview(input);
      const requirements = new Requirements(store, this.actor);
      const { id: publicationId, prior } = await requirements.publication(
        snapshot.row.data,
        snapshot.task.data.id,
      );
      if (prior && prior.data.state !== "failed") {
        if (prior.data.state === "created") return { existing: prior.data };
        throw new DomainError(
          "이슈 생성 결과 확인이 필요합니다. GitHub 원본을 확인하세요. 중복 방지를 위해 재발행하지 않습니다.",
          409,
        );
      }
      const publication: IssuePublication = {
        id: publicationId,
        requirement: snapshot.row.data.id,
        project: snapshot.row.data.project,
        task: snapshot.task.data.id,
        repository: snapshot.repository,
        state: "publishing",
      };
      const claimed = await store.save(
        "requirement-issue",
        publicationId,
        publication,
        this.actor.name,
        prior?.revision,
      );
      return { ...snapshot, publication, claimed: claimed! };
    });
    if ("existing" in prepared) return prepared.existing!;
    const {
      row,
      task,
      repository,
      title,
      body,
      assignee,
      publication,
      claimed,
    } = prepared;
    let issue;
    try {
      issue = await client.createIssue(repository, {
        title,
        body,
        ...(assignee ? { assignees: [assignee] } : {}),
      });
    } catch (error) {
      const definite =
        error instanceof GitHubRateLimitError ||
        (error instanceof GitHubError &&
          [400, 401, 403, 404, 410, 422].includes(error.status));
      await this.store.save(
        "requirement-issue",
        publication.id,
        { ...publication, state: definite ? "failed" : "unknown" },
        this.actor.name,
        claimed!.revision,
      );
      if (error instanceof GitHubRateLimitError) throw error;
      throw new DomainError(
        definite
          ? `GitHub 이슈 생성 실패 (HTTP ${(error as GitHubError).status}). 저장소의 Issues 쓰기 권한과 이슈 활성화를 확인하세요.`
          : "GitHub 응답을 확인하지 못했습니다. 중복 방지를 위해 GitHub 원본 확인 후 처리하세요.",
        502,
      );
    }
    const result: IssuePublication = {
      ...publication,
      state: "created",
      number: issue.number,
      url: issue.html_url,
      assignee,
      ...(assignee &&
      !issue.assignees.some(
        (person) => person.login.toLowerCase() === assignee.toLowerCase(),
      )
        ? {
            assignmentWarning:
              "이슈는 생성되었지만 GitHub 응답에서 담당자 배정을 확인하지 못했습니다. 원본 이슈에서 담당자를 확인하세요. 다시 발행하지 마세요.",
          }
        : {}),
    };
    const item = {
      id: `${repository}#${issue.number}`,
      repository,
      number: issue.number,
      kind: "issue" as const,
      title: issue.title,
      body: issue.body ?? body,
      author: issue.user.login,
      assignees: issue.assignees.map((person) => person.login),
      reviewers: [],
      state: "open",
      url: issue.html_url,
      updatedAt: issue.updated_at,
    };
    // 응답 수신 뒤 저장이 실패해도 publishing 기록을 남겨 자동 중복 발행을 막는다.
    await this.store.transaction(async (store) => {
      await store.save(
        "requirement-issue",
        publication.id,
        result,
        this.actor.name,
        claimed.revision,
      );
      await store.upsert("github", item.id, item, this.actor.name);
      await store.upsert(
        "link",
        `${task.data.id}:${item.id}`,
        {
          id: `${task.data.id}:${item.id}`,
          task: task.data.id,
          item: item.id,
          status: "approved",
          reason: "PRD에서 GitHub 이슈 생성",
          method: "manual",
        },
        this.actor.name,
      );
    });
    return result;
  }
}
