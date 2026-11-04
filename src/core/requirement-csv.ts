import { z } from "zod";
import { DomainError, id } from "./model";
import {
  requirementInput,
  requirementStates,
  type Requirement,
} from "./requirement-model";

export const csvFileInput = z.strictObject({
  project: id,
  fileName: z.string().min(1).max(255),
  csv: z.string(),
});
export const csvImportInput = csvFileInput.extend({
  mode: z.enum(["skip", "update"]),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
});
const aliases: Record<string, string> = {
  id: "sourceId",
  번호: "sourceId",
  넘버링: "sourceId",
  기능명: "featureName",
  상세설명: "description",
  설명: "description",
  정책: "policy",
  비고: "remarks",
  상태: "status",
  담당자: "assignee",
  최종편집일시: "editedAt",
  최종편집일자: "editedAt",
  최종편집자: "sourceEditor",
  편집자: "sourceEditor",
};
const normal = (value: string) =>
  value.normalize("NFKC").trim().replace(/[\s_]/g, "").toLowerCase();
export const sourceKey = (value: string) =>
  value.normalize("NFKC").trim().toLowerCase();

export function csvRecords(text: string, maxBytes = 1048576, maxRows = 500) {
  if (new TextEncoder().encode(text).length > maxBytes)
    throw new DomainError(
      `CSV 파일은 ${maxBytes / 1048576} MiB 이하로 올려주세요.`,
      413,
    );
  const rows: string[][] = [];
  let row: string[] = [],
    parts: string[] = [],
    segmentStart = 0,
    quoted = false,
    closed = false;
  const pushCell = () => {
    row.push(parts.join(""));
    parts = [];
    closed = false;
  };
  const pushRow = () => {
    pushCell();
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
    if (rows.length > maxRows + 1)
      throw new DomainError(
        `CSV는 한 번에 최대 ${maxRows.toLocaleString("en-US")}개 항목까지 가져올 수 있습니다.`,
      );
  };
  const input = text.replace(/^\uFEFF/, "");
  // 필드 전체를 조각으로 읽어 긴 설명마다 문자 수만큼 임시 문자열이 생기는 것을 막는다.
  const flush = (end: number) => {
    if (segmentStart < end) parts.push(input.slice(segmentStart, end));
  };
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"') {
        flush(i);
        if (input[i + 1] === '"') {
          parts.push('"');
          i++;
        } else {
          quoted = false;
          closed = true;
        }
        segmentStart = i + 1;
      } else if (char === "\r" && input[i + 1] === "\n") {
        flush(i);
        parts.push("\n");
        i++;
        segmentStart = i + 1;
      }
      continue;
    }
    if (char === ",") {
      flush(i);
      pushCell();
      segmentStart = i + 1;
      continue;
    }
    if (char === "\r" || char === "\n") {
      flush(i);
      if (char === "\r" && input[i + 1] === "\n") i++;
      pushRow();
      segmentStart = i + 1;
      continue;
    }
    if (char === '"') {
      if (parts.length || i > segmentStart || closed)
        throw new DomainError("CSV의 큰따옴표 형식을 확인하세요.");
      quoted = true;
      segmentStart = i + 1;
      continue;
    }
    if (closed) {
      if (char === " " || char === "\t") {
        segmentStart = i + 1;
        continue;
      }
      throw new DomainError("CSV 인용 필드 뒤에는 쉼표나 줄바꿈이 필요합니다.");
    }
  }
  if (quoted) throw new DomainError("CSV의 닫히지 않은 큰따옴표를 확인하세요.");
  flush(input.length);
  if (parts.length || row.length || closed) pushRow();
  return rows;
}

function editedDate(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (z.iso.datetime({ offset: true }).safeParse(text).success)
    return new Date(text).toISOString();
  const ko = text.match(
    /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(오전|오후)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/,
  );
  const iso = text.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!ko && !iso) throw new Error("최종 편집 일시의 형식을 확인하세요.");
  const match = ko ?? iso!;
  const year = Number(match[1]),
    month = Number(match[2]),
    day = Number(match[3]);
  let hour = ko ? Number(ko[5]) : Number(iso?.[4] ?? 0);
  const minute = Number(ko ? ko[6] : (iso?.[5] ?? 0)),
    second = Number(ko ? (ko[7] ?? 0) : (iso?.[6] ?? 0));
  if (ko) {
    if (hour < 1 || hour > 12)
      throw new Error("최종 편집 일시의 시간을 확인하세요.");
    hour = (hour % 12) + (ko[4] === "오후" ? 12 : 0);
  }
  const utc = Date.UTC(year, month - 1, day, hour - 9, minute, second);
  const local = new Date(utc + 9 * 3600000);
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    throw new Error("최종 편집 일시의 날짜를 확인하세요.");
  return new Date(utc).toISOString();
}
const statusAliases: Record<string, keyof typeof requirementStates> = {
  초안: "draft",
  대기: "draft",
  미시작: "draft",
  검토중: "in_review",
  리뷰중: "in_review",
  승인: "approved",
  진행중: "in_progress",
  완료: "completed",
  보류: "on_hold",
};
export interface CsvRequirementRow {
  row: number;
  data: z.infer<typeof requirementInput>;
  source: NonNullable<Requirement["source"]>;
  errors: string[];
}
export function parseRequirementCsv(input: z.infer<typeof csvFileInput>) {
  const records = csvRecords(input.csv);
  if (records.length < 2)
    throw new DomainError("CSV 헤더와 PRD 항목을 확인하세요.");
  const header = records[0]!;
  const columns = header.map((name) => aliases[normal(name)] ?? null);
  if (!columns.includes("sourceId") || !columns.includes("featureName"))
    throw new DomainError("CSV에는 ID(또는 넘버링)와 기능명 열이 필요합니다.");
  const recognized = columns.filter((c): c is string => !!c);
  if (new Set(recognized).size !== recognized.length)
    throw new DomainError("같은 의미의 CSV 열이 중복되어 있습니다.");
  const warnings = header
    .filter((_, i) => !columns[i])
    .map((name) => `‘${name}’ 열은 가져오지 않습니다.`);
  const rows: CsvRequirementRow[] = records.slice(1).map((cells, index) => {
    const values: Record<string, string> = {};
    columns.forEach((key, i) => {
      if (key) values[key] = cells[i] ?? "";
    });
    const errors: string[] = [];
    if (cells.length !== header.length)
      errors.push("CSV 열 개수가 헤더와 다릅니다.");
    const sourceId = (values.sourceId ?? "").trim();
    if (!sourceId) errors.push("ID가 비어 있습니다.");
    const rawStatus = (values.status ?? "").trim();
    const status = rawStatus
      ? (statusAliases[normal(rawStatus)] ??
        (Object.keys(requirementStates).includes(rawStatus)
          ? rawStatus
          : undefined))
      : "draft";
    if (rawStatus && !status)
      errors.push(
        "상태 값은 초안·검토 중·승인·진행 중·완료·보류 중에서 선택하세요.",
      );
    const data = {
      id: "csv",
      project: input.project,
      sourceId,
      featureName: (values.featureName ?? "").trim(),
      description: values.description ?? "",
      policy: values.policy ?? "",
      remarks: values.remarks ?? "",
      assignee: (values.assignee ?? "").trim(),
      status: status ?? "draft",
    };
    const parsed = requirementInput.safeParse(data);
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "");
        const label =
          (
            {
              sourceId: "ID",
              featureName: "기능명",
              description: "상세 설명",
              policy: "정책",
              remarks: "비고",
              assignee: "담당자",
            } as Record<string, string>
          )[field] ?? field;
        errors.push(`${label}의 필수 입력·최대 길이를 확인하세요.`);
      }
    let editedAt: string | null = null;
    try {
      editedAt = editedDate(values.editedAt ?? "");
    } catch (e) {
      errors.push((e as Error).message);
    }
    if ((values.sourceEditor ?? "").length > 100)
      errors.push("최종 편집자는 100자 이하여야 합니다.");
    return {
      row: index + 2,
      data: parsed.success
        ? parsed.data
        : (data as z.infer<typeof requirementInput>),
      source: {
        fileName: input.fileName,
        editedAt,
        editor: values.sourceEditor ?? "",
      },
      errors,
    };
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = sourceKey(row.data.sourceId ?? "");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const row of rows)
    if ((counts.get(sourceKey(row.data.sourceId ?? "")) ?? 0) > 1)
      row.errors.push("파일 안에서 ID가 중복되었습니다.");
  return {
    rows,
    warnings,
    fields: recognized.filter(
      (key) => !["editedAt", "sourceEditor"].includes(key),
    ),
    sourceFields: recognized.filter((key) =>
      ["editedAt", "sourceEditor"].includes(key),
    ),
  };
}
