import { z } from "zod";
import { stringify } from "yaml";
import { id, type Task } from "./model";

export const requirementStates = {
  draft: "초안",
  in_review: "검토 중",
  approved: "승인",
  in_progress: "진행 중",
  completed: "완료",
  on_hold: "보류",
} as const;
export const requirementInput = z.strictObject({
  id: id.max(80),
  project: id,
  sourceId: z
    .string()
    .trim()
    .max(80)
    .refine((value) => !/[\r\n\0]/.test(value), "ID는 한 줄로 입력하세요.")
    .optional(),
  featureName: z.string().trim().min(1).max(200),
  description: z.string().max(4000).default(""),
  policy: z.string().max(2000).default(""),
  policyIds: z.array(id).max(10).optional(),
  glossaryIds: z.array(id).max(10).optional(),
  remarks: z.string().max(1000).default(""),
  status: z
    .enum(
      Object.keys(requirementStates) as [
        keyof typeof requirementStates,
        ...Array<keyof typeof requirementStates>,
      ],
    )
    .default("draft"),
  assignee: z.string().trim().max(100).default(""),
});
export type Requirement = z.infer<typeof requirementInput> & {
  number: number;
  editor: string;
  featureId: string | null;
  taskId: string | null;
  source?: { fileName: string; editedAt: string | null; editor: string };
};
export type IssuePublication = {
  id: string;
  requirement: string;
  project: string;
  task: string;
  repository: string;
  state: "publishing" | "created" | "failed" | "unknown";
  number?: number;
  url?: string;
  assignee?: string;
  assignmentWarning?: string;
};
export const requirementEntries = z
  .array(z.strictObject({ id, revision: z.number().int().positive() }))
  .min(1)
  .max(100);
export const conversionInput = z.strictObject({
  entries: requirementEntries,
  feature: id.nullable().default(null),
});
export const publishInput = z.strictObject({
  id,
  revision: z.number().int().positive(),
  repository: z.string().regex(/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/),
  assignee: z.string().trim().max(100).optional(),
  previewHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export const requirementNumber = (number: number) =>
  `PRD-${String(number).padStart(3, "0")}`;
export const requirementLabel = (
  row: Pick<Requirement, "number" | "sourceId">,
  prefix?: string,
) =>
  prefix
    ? `${prefix}-${String(row.number).padStart(3, "0")}`
    : row.sourceId || requirementNumber(row.number);
export function requirementBody(
  row: Requirement,
  workspace: string,
  task?: Task,
  prefix?: string,
) {
  return [
    `## ${requirementLabel(row, prefix)} · ${row.featureName}`,
    ...(row.sourceId ? [`원본 ID: ${row.sourceId}`] : []),
    "### 상세설명",
    row.description || "미작성",
    "### 정책",
    row.policy || "미작성",
    "### 비고",
    row.remarks || "없음",
    `PRD 상태: ${requirementStates[row.status]}\n담당자: ${row.assignee || "미지정"}`,
    ...(task
      ? [
          "### Cloud PM 연결",
          "```yaml\n" +
            stringify({
              version: 1,
              workspace,
              project: row.project,
              feature: task.feature,
              task: task.id,
              requirement: row.id,
            }) +
            "```",
        ]
      : []),
  ].join("\n\n");
}
