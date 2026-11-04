import { z } from "zod";
import { DomainError, id, taskSchema } from "./model";
import { csvRecords } from "./requirement-csv";
import { ASANA_MAX_TASKS, ASANA_MAX_FILE_BYTES } from "./asana-limits";

export const asanaFileInput = z.strictObject({
  project: id,
  fileName: z.string().min(1).max(255),
  format: z.enum(["csv", "json"]),
  content: z.string().min(1),
  unresolvedParents: z.enum(["error", "keep_unlinked"]).optional(),
});
export const asanaImportInput = asanaFileInput.extend({
  mode: z.enum(["skip", "update"]),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  ids: z.array(z.string().min(1).max(100)).min(1).max(ASANA_MAX_TASKS),
});
export type AsanaRow = {
  row: number;
  sourceId: string;
  title: string;
  description: string;
  assignee: string;
  dueDate: string | null;
  priority: "low" | "medium" | "high";
  completed: boolean;
  parentRef: string;
  parentSourceId: string | null;
  fields: string[];
  errors: string[];
  warnings: string[];
  unresolvedParent?: boolean;
};
const normal = (value: string) =>
  value
    .normalize("NFKC")
    .replace(/[\s_()/.-]/g, "")
    .toLowerCase();
const aliases: Record<string, string> = {
  taskid: "sourceId",
  gid: "sourceId",
  id: "sourceId",
  작업id: "sourceId",
  name: "title",
  taskname: "title",
  작업명: "title",
  이름: "title",
  notes: "notes",
  description: "notes",
  설명: "notes",
  assignee: "assignee",
  담당자: "assignee",
  assigneeemail: "assigneeEmail",
  duedate: "dueDate",
  dueon: "dueDate",
  기한: "dueDate",
  completed: "completed",
  completedat: "completedAt",
  completiondate: "completedAt",
  완료일: "completedAt",
  parenttask: "parentRef",
  parent: "parentRef",
  상위작업: "parentRef",
  priority: "priority",
  우선순위: "priority",
};
const primaryHeaders: Record<string, string> = {
  sourceId: "taskid",
  title: "name",
  notes: "notes",
  assignee: "assignee",
  assigneeEmail: "assigneeemail",
  dueDate: "duedate",
  parentRef: "parenttask",
  completed: "completed",
  completedAt: "completedat",
};
const priorityValues: Record<string, AsanaRow["priority"]> = {
  high: "high",
  urgent: "high",
  높음: "high",
  긴급: "high",
  상: "high",
  높은우선순위: "high",
  medium: "medium",
  normal: "medium",
  보통: "medium",
  중: "medium",
  중간: "medium",
  low: "low",
  낮음: "low",
  하: "low",
  낮은우선순위: "low",
};

function csvColumns(header: string[], warnings: string[]) {
  const groups = new Map<string, number[]>();
  for (const [index, name] of header.entries()) {
    const key = normal(name);
    const field = Object.hasOwn(aliases, key) ? aliases[key] : undefined;
    if (field) groups.set(field, [...(groups.get(field) ?? []), index]);
  }
  for (const field of ["sourceId", "title"])
    if (!groups.has(field))
      throw new DomainError(
        "Asana CSV에는 Task ID와 Name(작업명) 열이 필요합니다.",
      );
  const selected = new Map<number, string>();
  const label = (index: number) =>
    `${header[index] || "추가 필드"} [${index + 1}열]`;
  for (const [field, candidates] of groups) {
    if (field === "priority") continue;
    const primary = candidates.filter(
      (index) => normal(header[index]!) === primaryHeaders[field],
    );
    const preferred = primary.length ? primary : candidates;
    if (preferred.length === 1) selected.set(preferred[0]!, field);
    else if (["sourceId", "title"].includes(field))
      throw new DomainError(
        `작업 ID/이름 열을 구분할 수 없습니다: ${preferred.map(label).join(", ")}`,
      );
    if (candidates.length > 1)
      warnings.push(
        `${candidates.map(label).join(", ")}: ${preferred.length === 1 ? `${label(preferred[0]!)}을 기본 필드로 사용하고 나머지는` : "자동으로 하나를 선택하지 않고 모두"} 추가 정보로 보존합니다.`,
      );
  }
  const duplicateNames = [
    ...new Set(header.filter((name, index) => header.indexOf(name) !== index)),
  ];
  if (duplicateNames.length)
    warnings.push(
      `동명 사용자 지정 열(${duplicateNames.join(", ")})은 열 번호로 구분해 각각 보존합니다.`,
    );
  return { selected, label, priority: groups.get("priority") ?? [] };
}
const text = (value: unknown) =>
  typeof value === "string"
    ? value
    : typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : "";
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const person = (value: unknown) =>
  typeof value === "string"
    ? value
    : text(object(value).name) || text(object(value).email);
const reference = (value: unknown) =>
  typeof value === "object"
    ? text(object(value).gid ?? object(value).id) || text(object(value).name)
    : text(value);

function makeRow(
  values: Record<string, unknown>,
  metadata: Record<string, string>,
  fields: string[],
  row: number,
): AsanaRow {
  const sourceId = text(values.sourceId).trim(),
    title = text(values.title).trim();
  const errors: string[] = [];
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(sourceId))
    errors.push(
      "유효한 Task ID/gid가 필요합니다. 숫자 ID를 반올림하거나 지수 표기로 바꾸지 마세요.",
    );
  const due = text(values.dueDate).trim();
  const dueDate = due ? due.slice(0, 10) : null;
  if (dueDate && !z.iso.date().safeParse(dueDate).success)
    errors.push("기한은 YYYY-MM-DD 형식이어야 합니다.");
  const completed =
    values.completed === true ||
    ["true", "yes", "1", "완료"].includes(
      text(values.completed).toLowerCase(),
    ) ||
    !!text(values.completedAt).trim();
  const rawPriority = normal(text(values.priority));
  const knownPriority = Object.hasOwn(priorityValues, rawPriority)
    ? priorityValues[rawPriority]
    : undefined;
  const priority = knownPriority ?? "medium";
  if (rawPriority && !knownPriority)
    errors.push("우선순위는 low/medium/high 또는 낮음/보통/높음이어야 합니다.");
  const assignee = (
    person(values.assignee) || text(values.assigneeEmail)
  ).trim();
  const description = [
    text(values.notes),
    "---",
    `Asana에서 가져옴 · 원본 ID: ${sourceId}`,
    `원본 상태: ${completed ? "완료" : "미완료"}`,
    reference(values.parentRef).trim()
      ? `원본 상위 작업: ${reference(values.parentRef).trim()}`
      : "",
    ...Object.entries(metadata)
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}: ${value}`),
  ]
    .filter(Boolean)
    .join("\n\n");
  const parsed = taskSchema.safeParse({
    id: "preview",
    project: "preview",
    title,
    description,
    assignee,
    dueDate:
      dueDate && z.iso.date().safeParse(dueDate).success ? dueDate : null,
    priority,
  });
  if (!parsed.success)
    errors.push(
      ...parsed.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
    );
  return {
    row,
    sourceId,
    title,
    description,
    assignee,
    dueDate,
    priority,
    completed,
    parentRef: reference(values.parentRef).trim(),
    parentSourceId: null,
    fields,
    errors,
    warnings: [],
  };
}

export function parseAsanaFile(
  input: z.infer<typeof asanaFileInput>,
  options: { allowEmpty?: boolean } = {},
) {
  if (new TextEncoder().encode(input.content).length > ASANA_MAX_FILE_BYTES)
    throw new DomainError("Asana 파일은 10 MiB 이하로 올려주세요.", 413);
  const rows: AsanaRow[] = [];
  const warnings = [
    "Asana 완료 여부는 원본 정보로 보존합니다. 가져온 작업은 대기 상태이며 직접 완료하거나 PR 머지 조건으로 자동 완료할 수 있습니다.",
    "담당자는 원본 이름/이메일로 저장합니다. Asana 계정·댓글·첨부파일은 생성하거나 다운로드하지 않습니다.",
  ];
  if (input.format === "csv") {
    const records = csvRecords(
      input.content,
      ASANA_MAX_FILE_BYTES,
      ASANA_MAX_TASKS,
    );
    const header = records.shift();
    if (!header || (!records.length && !options.allowEmpty))
      throw new DomainError("CSV 헤더와 작업 행이 필요합니다.");
    const columns = csvColumns(header, warnings);
    if (records.length > ASANA_MAX_TASKS)
      throw new DomainError(
        "한 프로젝트당 최대 10,000개 작업을 가져올 수 있습니다.",
      );
    let priorityWarnings = 0;
    let untitledWarnings = 0;
    records.forEach((cells, index) => {
      const values: Record<string, unknown> = {},
        metadata: Record<string, string> = {};
      const fields = [...columns.selected.values()];
      for (const [column] of header.entries()) {
        const field = columns.selected.get(column);
        if (field) values[field] = cells[column] ?? "";
        else metadata[columns.label(column)] = cells[column] ?? "";
      }
      const untitled = !text(values.title).trim();
      if (untitled) {
        values.title = `이름 없는 Asana 작업 (${text(values.sourceId).trim()})`;
        fields.splice(fields.indexOf("title"), 1);
        metadata["원본 작업 이름"] = "(비어 있음)";
        untitledWarnings++;
      }
      const rawPriorities = columns.priority
        .map((index) => (cells[index] ?? "").trim())
        .filter(Boolean);
      const normalizedPriorities = rawPriorities.map((value) =>
        Object.hasOwn(priorityValues, normal(value))
          ? priorityValues[normal(value)]
          : undefined,
      );
      const safePriority =
        rawPriorities.length > 0 &&
        normalizedPriorities.every(Boolean) &&
        new Set(normalizedPriorities).size === 1;
      if (
        safePriority ||
        (!rawPriorities.length && columns.priority.length === 1)
      ) {
        fields.push("priority");
        values.priority = safePriority ? normalizedPriorities[0] : "";
      }
      const row = makeRow(values, metadata, fields, index + 2);
      if (untitled)
        row.warnings.push(
          "원본 이름이 비어 있어 ID를 포함한 임시 제목을 표시합니다. 기존 작업 제목은 유지합니다.",
        );
      if (rawPriorities.length && !safePriority) {
        priorityWarnings++;
        row.warnings.push(
          "우선순위가 별도 등급이거나 여러 값이 충돌해 자동 변환을 생략합니다. 원본은 설명에 보존하고 기존 우선순위는 유지합니다. 새 작업은 보통입니다.",
        );
      }
      if (cells.length !== header.length)
        row.errors.push("열 개수가 헤더와 다릅니다.");
      rows.push(row);
    });
    if (priorityWarnings)
      warnings.push(
        `${priorityWarnings}개 작업은 우선순위를 자동 변환하지 않았습니다. 원문을 확인하세요. 기존 우선순위는 유지하며 새 작업은 보통입니다.`,
      );
    if (untitledWarnings)
      warnings.push(
        `이름 없는 작업 ${untitledWarnings}개는 원본 ID를 포함한 임시 제목을 사용합니다. 기존 작업 제목은 유지합니다.`,
      );
  } else {
    let json: unknown;
    try {
      json = JSON.parse(input.content.replace(/^\uFEFF/, ""));
    } catch {
      throw new DomainError("올바른 JSON 파일인지 확인하세요.");
    }
    const root = object(json),
      data = root.data ?? json;
    const items = Array.isArray(data)
      ? data
      : Array.isArray(object(data).tasks)
        ? (object(data).tasks as unknown[])
        : object(data).resource_type === "task" ||
            object(data).gid ||
            object(data).id
          ? [data]
          : options.allowEmpty &&
              (root.project ||
                object(data).project ||
                object(data).resource_type === "project")
            ? []
            : null;
    if (!items)
      throw new DomainError(
        "JSON에는 작업 배열, data 배열 또는 tasks 배열이 필요합니다.",
      );
    const visit = (raw: unknown, parent = "", depth = 0) => {
      const task = object(raw);
      if (task.resource_type && task.resource_type !== "task") return;
      if (depth > 32 || rows.length >= ASANA_MAX_TASKS)
        throw new DomainError(
          "한 프로젝트당 최대 10,000개 작업, 최대 32단계 하위 작업까지 가져올 수 있습니다.",
        );
      const fields = ["sourceId", "title"];
      for (const [source, target] of [
        ["notes", "notes"],
        ["assignee", "assignee"],
        ["due_on", "dueDate"],
        ["due_at", "dueDate"],
        ["parent", "parentRef"],
        ["priority", "priority"],
      ])
        if (source! in task) fields.push(target!);
      if (parent) fields.push("parentRef");
      const priorityField = Array.isArray(task.custom_fields)
        ? task.custom_fields
            .map(object)
            .find((field) =>
              ["priority", "우선순위"].includes(normal(text(field.name))),
            )
        : undefined;
      const customPriority = priorityField
        ? text(priorityField.display_value) ||
          text(priorityField.text_value) ||
          person(priorityField.enum_value)
        : "";
      if (priorityField) fields.push("priority");
      const metadata: Record<string, string> = {};
      for (const key of [
        "start_on",
        "created_at",
        "modified_at",
        "completed_at",
        "permalink_url",
      ])
        if (text(task[key])) metadata[key] = text(task[key]);
      if (Array.isArray(task.tags))
        metadata.Tags = task.tags.map(person).filter(Boolean).join(", ");
      if (Array.isArray(task.projects))
        metadata.Projects = task.projects
          .map(person)
          .filter(Boolean)
          .join(", ");
      if (Array.isArray(task.memberships))
        metadata.Sections = task.memberships
          .map((item) => person(object(item).section))
          .filter(Boolean)
          .join(", ");
      if (Array.isArray(task.custom_fields))
        metadata["Custom fields"] = task.custom_fields
          .map((item) => {
            const field = object(item);
            return `${text(field.name)}: ${text(field.display_value) || text(field.text_value) || person(field.enum_value)}`;
          })
          .join("; ");
      const row = makeRow(
        {
          sourceId: task.gid ?? task.id,
          title: task.name,
          notes: task.notes,
          assignee: task.assignee,
          dueDate: task.due_on ?? task.due_at,
          parentRef: task.parent ?? parent,
          priority: task.priority ?? customPriority,
          completed: task.completed,
          completedAt: task.completed_at,
        },
        metadata,
        [...new Set(fields)],
        rows.length + 1,
      );
      rows.push(row);
      if (Array.isArray(task.subtasks))
        for (const child of task.subtasks)
          visit(child, row.sourceId, depth + 1);
    };
    const projectContainers = items.filter(
      (raw) =>
        object(raw).resource_type !== "task" &&
        Array.isArray(object(raw).tasks),
    );
    if (projectContainers.length > 1)
      throw new DomainError(
        "여러 프로젝트가 포함되어 있습니다. 프로젝트별로 파일을 내보내 주세요.",
      );
    const taskItems =
      projectContainers.length === 1
        ? (object(projectContainers[0]).tasks as unknown[])
        : items;
    for (const raw of taskItems) visit(raw);
  }
  if (!rows.length && !options.allowEmpty)
    throw new DomainError("가져올 작업이 없습니다.");
  const ids = new Map<string, number>();
  for (const row of rows)
    ids.set(row.sourceId, (ids.get(row.sourceId) ?? 0) + 1);
  for (const row of rows)
    if ((ids.get(row.sourceId) ?? 0) > 1)
      row.errors.push("파일에 같은 Asana 작업 ID가 여러 번 있습니다.");
  return { rows, warnings };
}
