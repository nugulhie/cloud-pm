import { createHash } from "node:crypto";
import { asanaFileInput, asanaImportInput, parseAsanaFile } from "./asana-file";
import { DomainError, taskSchema, type Task, type Stored } from "./model";
import { inputFields } from "./entity-patch";
import type { Store } from "../db/store";

type Origin = {
  id: string;
  project: string;
  sourceId: string;
  taskId: string;
  title: string;
  completed: boolean;
  fileName: string;
  parentRef?: string;
  unresolvedParent?: boolean;
};
const key = (project: string, source: string) =>
  `asana-${createHash("sha256").update(`${project}\0${source}`).digest("hex").slice(0, 40)}`;
const taskId = (project: string, source: string) =>
  `task-${key(project, source)}`;

export async function previewAsana(
  store: Store,
  input: unknown,
  options: { allowEmpty?: boolean } = {},
) {
  const file = asanaFileInput.parse(input),
    parsed = parseAsanaFile(file, options);
  const mappings = (await store.list<Origin>("asana-import")).filter(
    (row) => row.data.project === file.project,
  );
  const tasks = (await store.list<Task>("task")).filter(
    (row) => row.data.project === file.project,
  );
  const originsById = new Map(mappings.map((row) => [row.data.sourceId, row]));
  const tasksById = new Map(tasks.map((row) => [row.data.id, row]));
  const rows = parsed.rows.map((row) => {
    const origin = originsById.get(row.sourceId);
    const old = origin ? tasksById.get(origin.data.taskId) : undefined;
    if (origin && !old)
      row.errors.push(
        "이전에 가져온 작업이 삭제되었습니다. 자동으로 다시 만들지 않습니다.",
      );
    if (!origin && tasksById.has(taskId(file.project, row.sourceId)))
      row.errors.push("기존 작업과 식별자가 충돌합니다.");
    return {
      ...row,
      existing: old ? { id: old.data.id, revision: old.revision } : null,
      originRevision: origin?.revision ?? null,
    };
  });
  const parentsByReference = new Map<string, Set<string>>();
  const indexParent = (sourceId: string, title: string) => {
    for (const ref of [sourceId, title]) {
      const ids = parentsByReference.get(ref) ?? new Set<string>();
      ids.add(sourceId);
      parentsByReference.set(ref, ids);
    }
  };
  for (const row of rows) indexParent(row.sourceId, row.title);
  for (const row of mappings) indexParent(row.data.sourceId, row.data.title);
  for (const row of rows) {
    if (!row.parentRef) continue;
    const candidates = [...(parentsByReference.get(row.parentRef) ?? [])];
    if (candidates.length !== 1) {
      row.unresolvedParent = true;
      const reason = "상위 작업이 없거나 이름이 중복됩니다.";
      if (file.unresolvedParents === "keep_unlinked")
        row.warnings.push(
          `${reason} 원본을 보존하고 새 작업의 상위는 연결하지 않습니다. 기존 상위 연결은 유지합니다.`,
        );
      else
        row.errors.push(
          `${reason} 상위 작업을 같은 파일에 포함하거나 Task ID로 지정하세요.`,
        );
    } else row.parentSourceId = candidates[0]!;
  }
  const rowsById = new Map(rows.map((row) => [row.sourceId, row]));
  for (const row of rows) {
    const seen = new Set([row.sourceId]);
    let parent = row.parentSourceId;
    while (parent) {
      if (seen.has(parent)) {
        row.errors.push("상위 작업 관계가 순환합니다.");
        break;
      }
      seen.add(parent);
      parent = rowsById.get(parent)?.parentSourceId ?? null;
    }
  }
  const previewHash = createHash("sha256")
    .update(
      JSON.stringify({
        workspace: store.workspaceId,
        file,
        rows: rows.map((row) => [
          row.sourceId,
          row.parentSourceId,
          row.existing,
          row.originRevision,
          row.errors,
        ]),
      }),
    )
    .digest("hex");
  const unresolvedParents = rows.filter((row) => row.unresolvedParent).length;
  if (unresolvedParents && file.unresolvedParents === "keep_unlinked")
    parsed.warnings.push(
      `${unresolvedParents}개 작업의 상위를 구분할 수 없어 원본을 보존합니다. 새 작업은 상위 미연결로 가져오고 기존 상위 연결은 유지합니다.`,
    );
  return {
    project: file.project,
    fileName: file.fileName,
    format: file.format,
    rows,
    warnings: parsed.warnings,
    counts: {
      total: rows.length,
      invalid: rows.filter((row) => row.errors.length).length,
      existing: rows.filter((row) => row.existing).length,
      new: rows.filter((row) => !row.existing).length,
      unresolvedParents,
    },
    previewHash,
  };
}

export async function importAsana(
  store: Store,
  actor: string,
  input: unknown,
  saveTask: (
    value: unknown,
    revision?: number,
  ) => Promise<Stored<Task> | undefined>,
) {
  const data = asanaImportInput.parse(input),
    preview = await previewAsana(store, {
      project: data.project,
      fileName: data.fileName,
      format: data.format,
      content: data.content,
      unresolvedParents: data.unresolvedParents,
    });
  if (preview.previewHash !== data.previewHash)
    throw new DomainError(
      "미리보기 이후 작업이 변경되었습니다. 다시 미리 확인하세요.",
      409,
    );
  const selected = new Set(data.ids);
  if (selected.size !== data.ids.length)
    throw new DomainError("선택한 작업 ID가 중복됩니다.");
  const rows = preview.rows.filter((row) => selected.has(row.sourceId));
  if (rows.length !== selected.size || rows.some((row) => row.errors.length))
    throw new DomainError("선택 항목의 오류를 확인하세요.");
  const origins = (await store.list<Origin>("asana-import")).filter(
    (row) => row.data.project === data.project,
  );
  const originsById = new Map(origins.map((row) => [row.data.sourceId, row]));
  const parentTaskId = (source: string) =>
    originsById.get(source)?.data.taskId ?? taskId(data.project, source);
  for (const row of rows)
    if (
      row.parentSourceId &&
      !selected.has(row.parentSourceId) &&
      !(await store.get<Task>("task", parentTaskId(row.parentSourceId)))
    )
      throw new DomainError(`‘${row.title}’의 상위 작업을 함께 선택하세요.`);
  const children = new Map<string, typeof rows>();
  const ordered = rows.filter(
    (row) => !row.parentSourceId || !selected.has(row.parentSourceId),
  );
  for (const row of rows) {
    if (!row.parentSourceId || !selected.has(row.parentSourceId)) continue;
    const siblings = children.get(row.parentSourceId) ?? [];
    siblings.push(row);
    children.set(row.parentSourceId, siblings);
  }
  for (let index = 0; index < ordered.length; index++)
    for (const child of children.get(ordered[index]!.sourceId) ?? [])
      ordered.push(child);
  if (ordered.length !== rows.length)
    throw new DomainError("상위 작업 관계를 확인하세요.");
  let created = 0,
    updated = 0,
    skipped = 0;
  for (const row of ordered) {
    if (row.existing && data.mode === "skip") {
      skipped++;
      continue;
    }
    const old = row.existing
      ? await store.get<Task>("task", row.existing.id)
      : undefined;
    if (row.existing && !old)
      throw new DomainError(
        "작업이 변경되었습니다. 다시 미리 확인하세요.",
        409,
      );
    const value: Record<string, unknown> = old
      ? inputFields(taskSchema, old.data)
      : {
          id: taskId(data.project, row.sourceId),
          project: data.project,
          title: row.title,
          description: row.description,
          assignee: row.assignee,
          dueDate: row.dueDate,
          priority: row.priority,
        };
    const fields: Record<string, string> = {
      title: "title",
      notes: "description",
      assignee: "assignee",
      assigneeEmail: "assignee",
      dueDate: "dueDate",
      priority: "priority",
    };
    for (const field of row.fields) {
      const target = fields[field];
      if (target) value[target] = row[target as keyof typeof row];
    }
    if (
      old &&
      (row.fields.includes("assignee") || row.fields.includes("assigneeEmail"))
    )
      delete value.assigneeUserId;
    if (!old || (row.fields.includes("parentRef") && !row.unresolvedParent))
      value.parentId = row.parentSourceId
        ? parentTaskId(row.parentSourceId)
        : null;
    const saved = await saveTask(value, old?.revision);
    if (!saved) throw new DomainError("작업을 저장하지 못했습니다.");
    const mappingId = key(data.project, row.sourceId);
    await store.save<Origin>(
      "asana-import",
      mappingId,
      {
        id: mappingId,
        project: data.project,
        sourceId: row.sourceId,
        taskId: saved.data.id,
        title:
          !old || row.fields.includes("title")
            ? row.title
            : (originsById.get(row.sourceId)?.data.title ?? saved.data.title),
        completed: row.completed,
        fileName: data.fileName,
        parentRef: row.parentRef,
        unresolvedParent: row.unresolvedParent ?? false,
      },
      actor,
      row.originRevision ?? undefined,
    );
    if (old) updated++;
    else created++;
  }
  return { created, updated, skipped };
}
