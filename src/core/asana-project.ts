import { createHash } from "node:crypto";
import { z } from "zod";
import { DomainError, projectSchema, type Project, type Stored } from "./model";
import { csvRecords } from "./requirement-csv";
import { previewAsana, importAsana } from "./asana-import";
import { parseAsanaFile } from "./asana-file";
import { ASANA_MAX_TASKS, ASANA_MAX_FILE_BYTES } from "./asana-limits";
import type { Store } from "../db/store";

export const asanaProjectFileInput = z.strictObject({
  fileName: z.string().min(1).max(255),
  format: z.enum(["csv", "json"]),
  content: z.string().min(1),
  unresolvedParents: z.enum(["error", "keep_unlinked"]).optional(),
  projectName: z.string().trim().min(1).max(200).optional(),
  sourceProjectKey: z.string().trim().min(1).max(300).optional(),
});
export const asanaProjectImportInput = asanaProjectFileInput.extend({
  mode: z.enum(["skip", "update"]),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  ids: z.array(z.string().min(1).max(100)).max(ASANA_MAX_TASKS),
});
type ProjectOrigin = {
  id: string;
  provider: "asana";
  sourceKey: string;
  sourceProjectId: string | null;
  sourceName: string;
  projectId: string;
};
const normal = (value: string) => value.normalize("NFKC").trim().toLowerCase();
const text = (value: unknown) =>
  typeof value === "string"
    ? value
    : typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : "";
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 40);
const originId = (key: string) => `asana-project-${hash(key)}`;

export function asanaProjectMetadata(
  file: z.infer<typeof asanaProjectFileInput>,
) {
  if (Buffer.byteLength(file.content) > ASANA_MAX_FILE_BYTES)
    throw new DomainError("Asana 파일은 10 MiB 이하로 올려주세요.", 413);
  let project: Record<string, unknown> = {},
    warnings: string[] = [];
  if (file.format === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.content.replace(/^\uFEFF/, ""));
    } catch {
      throw new DomainError("올바른 JSON 파일인지 확인하세요.");
    }
    const root = obj(parsed),
      data = root.data ?? parsed,
      envelope = obj(data);
    project = obj(root.project ?? envelope.project);
    if (
      !Object.keys(project).length &&
      (envelope.resource_type === "project" ||
        (Array.isArray(envelope.tasks) &&
          text(envelope.name) &&
          text(envelope.gid ?? envelope.id)))
    )
      project = envelope;
    if (!Object.keys(project).length && Array.isArray(data)) {
      const containers = data
        .map(obj)
        .filter(
          (value) =>
            value.resource_type !== "task" && Array.isArray(value.tasks),
        );
      if (containers.length > 1)
        throw new DomainError(
          "여러 프로젝트가 포함되어 있습니다. 프로젝트별로 파일을 내보내 주세요.",
        );
      if (containers.length === 1) project = containers[0]!;
    }
    if (!Object.keys(project).length) {
      const tasks = Array.isArray(data)
        ? data
        : Array.isArray(envelope.tasks)
          ? envelope.tasks
          : [];
      const memberships = tasks
        .map((task) => {
          const row = obj(task);
          return [
            ...(Array.isArray(row.projects) ? row.projects : []),
            ...(Array.isArray(row.memberships)
              ? row.memberships.map((value) => obj(value).project)
              : []),
          ]
            .map(obj)
            .filter((value) => text(value.gid ?? value.id) && text(value.name));
        })
        .filter((values) => values.length);
      const candidates =
        memberships[0]?.filter((candidate) =>
          memberships.every((values) =>
            values.some(
              (value) =>
                text(value.gid ?? value.id) ===
                text(candidate.gid ?? candidate.id),
            ),
          ),
        ) ?? [];
      const unique = [
        ...new Map(
          candidates.map((value) => [text(value.gid ?? value.id), value]),
        ).values(),
      ];
      if (unique.length === 1) project = unique[0]!;
      else if (unique.length > 1)
        warnings.push(
          "파일에 여러 프로젝트 정보가 있습니다. 가져올 프로젝트 이름과 원본 키를 확인하세요.",
        );
    }
  } else {
    const records = csvRecords(
        file.content,
        ASANA_MAX_FILE_BYTES,
        ASANA_MAX_TASKS,
      ),
      header = records.shift() ?? [];
    const field = (aliases: string[]) =>
      header.findIndex((column) =>
        aliases.includes(normal(column).replace(/[\s_/-]/g, "")),
      );
    const nameIndex = field([
        "projectname",
        "프로젝트명",
        "projects",
        "project",
      ]),
      idIndex = field(["projectid", "projectgid", "프로젝트id"]);
    const values = (index: number) => [
      ...new Set(
        records.map((row) => (row[index] ?? "").trim()).filter(Boolean),
      ),
    ];
    const names = values(nameIndex),
      ids = values(idIndex);
    if (names.length === 1) project.name = names[0];
    else if (names.length > 1)
      warnings.push(
        "프로젝트 이름이 여러 개입니다. 한 파일의 작업은 하나의 프로젝트로 가져옵니다. 이름과 원본 키를 확인하세요.",
      );
    if (ids.length === 1) project.gid = ids[0];
    else if (ids.length > 1)
      throw new DomainError(
        "여러 프로젝트 ID가 포함되어 있습니다. 프로젝트별로 파일을 내보내 주세요.",
      );
  }
  const sourceId = text(project.gid ?? project.id) || null;
  if ((project.gid !== undefined || project.id !== undefined) && !sourceId)
    throw new DomainError(
      "원본 프로젝트 ID를 문자열로 저장한 파일을 사용하세요.",
    );
  const sourceName =
    text(project.name).trim() ||
    file.fileName.replace(/\.(csv|json)$/i, "").trim();
  const name = file.projectName ?? sourceName;
  const sourceKey = normal(
    file.sourceProjectKey ??
      (sourceId ? `id:${sourceId}` : `name:${sourceName}`),
  );
  if (!sourceId && !file.sourceProjectKey)
    warnings.push(
      "원본 프로젝트 ID가 없어 이름 기반 키를 사용합니다. 파일/프로젝트 이름을 바꿔 다시 가져올 때는 기존 원본 키를 유지하세요.",
    );
  const metadata: Partial<Project> = {};
  if (typeof project.notes === "string") metadata.goal = project.notes;
  if ("start_on" in project)
    metadata.startDate =
      project.start_on === null ? null : text(project.start_on);
  if ("due_on" in project || "due_date" in project) {
    const due =
      project.due_on !== undefined ? project.due_on : project.due_date;
    metadata.endDate = due === null ? null : text(due);
  }
  return {
    sourceId,
    sourceName,
    sourceKey,
    name,
    metadata,
    warnings,
    hasProjectName: !!text(project.name).trim(),
  };
}

export async function previewAsanaProject(
  store: Store,
  input: unknown,
  access: (id: string) => Promise<unknown>,
) {
  const file = asanaProjectFileInput.parse(input),
    meta = asanaProjectMetadata(file);
  const origins = (await store.list<ProjectOrigin>("external-project")).filter(
    (row) => row.data.provider === "asana",
  );
  let origin = origins.find(
    (row) =>
      row.data.sourceKey === meta.sourceKey ||
      (!!meta.sourceId && row.data.sourceProjectId === meta.sourceId),
  );
  if (!origin && !file.sourceProjectKey) {
    const candidates = origins.filter(
      (row) =>
        normal(row.data.sourceName) === normal(meta.sourceName) &&
        (!meta.sourceId || !row.data.sourceProjectId),
    );
    if (candidates.length > 1)
      throw new DomainError(
        "이름이 같은 외부 프로젝트가 여러 개입니다. 원본 프로젝트 키를 지정하세요.",
      );
    if (candidates.length === 1) {
      const candidate = candidates[0]!;
      await access(candidate.data.projectId);
      if (meta.sourceId && !candidate.data.sourceProjectId) {
        const sourceIds = new Set(
          parseAsanaFile(
            { project: "preview", ...file },
            { allowEmpty: true },
          ).rows.map((row) => row.sourceId),
        );
        const mappedTasks = await store.list<{
          project: string;
          sourceId: string;
        }>("asana-import");
        if (
          !mappedTasks.some(
            (row) =>
              row.data.project === candidate.data.projectId &&
              sourceIds.has(row.data.sourceId),
          )
        )
          throw new DomainError(
            "이름이 같은 CSV 프로젝트가 있습니다. 동일한 프로젝트라면 기존 원본 키를 지정하세요.",
          );
      }
      origin = candidate;
    }
  }
  if (origin) {
    await access(origin.data.projectId);
    if (!file.sourceProjectKey && !meta.sourceId) {
      const ids = new Set(
        parseAsanaFile(
          { project: "preview", ...file },
          { allowEmpty: true },
        ).rows.map((row) => row.sourceId),
      );
      const mapped = await store.list<{ project: string; sourceId: string }>(
        "asana-import",
      );
      if (
        ids.size &&
        !mapped.some(
          (row) =>
            row.data.project === origin!.data.projectId &&
            ids.has(row.data.sourceId),
        )
      )
        throw new DomainError(
          `이름은 같지만 일치하는 작업이 없습니다. 동일한 프로젝트라면 원본 키 ‘${origin.data.sourceKey}’를 지정하세요.`,
        );
    }
    if (
      meta.sourceId &&
      origin.data.sourceProjectId &&
      meta.sourceId !== origin.data.sourceProjectId
    )
      throw new DomainError(
        "선택한 원본 키의 Asana 프로젝트 ID가 파일과 다릅니다.",
      );
  }
  const projectId =
    origin?.data.projectId ??
    `project-${hash(`${store.workspaceId}\0${meta.sourceKey}`)}`;
  const existing = origin
    ? await store.get<Project>("project", projectId)
    : undefined;
  if (origin && !existing)
    throw new DomainError(
      "가져온 프로젝트가 삭제되었습니다. 자동으로 복원하지 않습니다.",
      409,
    );
  if (!origin && (await store.get("project", projectId)))
    throw new DomainError("프로젝트 식별자가 충돌합니다.", 409);
  const project = projectSchema.parse({
    ...(existing?.data ?? {}),
    id: projectId,
    name:
      file.projectName ??
      (meta.hasProjectName ? meta.name : (existing?.data.name ?? meta.name)),
    goal: existing?.data.goal ?? "",
    repositories: existing?.data.repositories ?? [],
    ...meta.metadata,
  });
  if (
    project.startDate &&
    project.endDate &&
    project.startDate > project.endDate
  )
    throw new DomainError("프로젝트 종료일은 시작일 이후여야 합니다.");
  const tasks = await previewAsana(
    store,
    {
      project: projectId,
      fileName: file.fileName,
      format: file.format,
      content: file.content,
      unresolvedParents: file.unresolvedParents,
    },
    { allowEmpty: true },
  );
  const sourceKey = origin?.data.sourceKey ?? meta.sourceKey;
  const previewHash = createHash("sha256")
    .update(
      JSON.stringify({
        workspace: store.workspaceId,
        sourceKey,
        sourceId: meta.sourceId,
        project,
        revision: existing?.revision ?? null,
        originRevision: origin?.revision ?? null,
        tasks: tasks.previewHash,
      }),
    )
    .digest("hex");
  return {
    ...tasks,
    previewHash,
    projectInfo: {
      data: project,
      currentData: existing?.data ?? null,
      existing: existing
        ? { id: projectId, revision: existing.revision }
        : null,
      sourceKey,
      sourceProjectId: meta.sourceId ?? origin?.data.sourceProjectId ?? null,
      sourceName: meta.hasProjectName
        ? meta.sourceName
        : (origin?.data.sourceName ?? meta.sourceName),
    },
    warnings: [...meta.warnings, ...tasks.warnings],
  };
}

export async function importAsanaProject(
  store: Store,
  actor: string,
  input: unknown,
  access: (id: string) => Promise<unknown>,
  saveProject: (value: unknown, revision?: number) => Promise<unknown>,
  saveTask: Parameters<typeof importAsana>[3],
) {
  const data = asanaProjectImportInput.parse(input);
  const file = {
    fileName: data.fileName,
    format: data.format,
    content: data.content,
    unresolvedParents: data.unresolvedParents,
    ...(data.projectName ? { projectName: data.projectName } : {}),
    ...(data.sourceProjectKey
      ? { sourceProjectKey: data.sourceProjectKey }
      : {}),
  };
  const preview = await previewAsanaProject(store, file, access);
  if (preview.previewHash !== data.previewHash)
    throw new DomainError(
      "미리보기 이후 프로젝트나 작업이 변경되었습니다. 다시 미리 확인하세요.",
      409,
    );
  const info = preview.projectInfo;
  if (!info.existing || data.mode === "update")
    await saveProject(info.data, info.existing?.revision);
  const taskFile = {
    project: info.data.id,
    fileName: data.fileName,
    format: data.format,
    content: data.content,
    unresolvedParents: data.unresolvedParents,
  };
  const taskPreview = await previewAsana(store, taskFile, { allowEmpty: true });
  const result = data.ids.length
    ? await importAsana(
        store,
        actor,
        {
          ...taskFile,
          mode: data.mode,
          previewHash: taskPreview.previewHash,
          ids: data.ids,
        },
        saveTask,
      )
    : { created: 0, updated: 0, skipped: 0 };
  const mappingId = originId(info.sourceKey),
    old = await store.get<ProjectOrigin>("external-project", mappingId);
  await store.save<ProjectOrigin>(
    "external-project",
    mappingId,
    {
      id: mappingId,
      provider: "asana",
      sourceKey: info.sourceKey,
      sourceProjectId: info.sourceProjectId,
      sourceName: info.sourceName,
      projectId: info.data.id,
    },
    actor,
    old?.revision,
  );
  return { project: info.data.id, projectCreated: !info.existing, ...result };
}
