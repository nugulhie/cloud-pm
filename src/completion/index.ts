import { Buffer } from "node:buffer";
import { parseDocument } from "yaml";
import { z } from "zod";

const identifier = z.string().trim().min(1).max(200);
const rule = z.strictObject({
  pull_request: z.strictObject({
    repository: z.string().regex(/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/),
    number: z.number().int().positive(),
    state: z.literal("merged"),
    target_branch: identifier,
  }),
});
export const taskSchema = z.strictObject({
  version: z.literal(1),
  task: identifier,
  project: identifier,
  feature: identifier,
  completion: z.union([
    z.strictObject({ all: z.array(rule).min(1).max(100) }),
    z.strictObject({ any: z.array(rule).min(1).max(100) }),
  ]),
});
export type TaskDefinition = z.infer<typeof taskSchema>;
export type PullRequestRule = z.infer<typeof rule>["pull_request"];
export type ResultState = "satisfied" | "unsatisfied" | "unknown";

export function parseTaskYaml(source: string): TaskDefinition {
  if (Buffer.byteLength(source, "utf8") > 64 * 1024) {
    throw new Error("태스크 YAML은 64 KiB 이하여야 합니다.");
  }
  const document = parseDocument(source, { uniqueKeys: true, strict: true });
  if (document.errors.length || document.warnings.length) {
    throw new Error(
      [...document.errors, ...document.warnings]
        .map((e) => e.message)
        .join("\n"),
    );
  }
  return taskSchema.parse(document.toJS({ maxAliasCount: 0 }));
}

export interface PullRequestSnapshot {
  state: "open" | "closed";
  mergedAt: string | null;
  targetBranch: string;
  observedAt: string;
}

// 실제 데이터 조회와 권한 검사는 호출 측 어댑터가 담당한다.
export type PullRequestReader = (
  repository: string,
  number: number,
) => Promise<PullRequestSnapshot>;

export interface ConditionResult {
  condition: PullRequestRule;
  state: ResultState;
  reason: string;
  url: string;
  observedAt: string | null;
  mergedAt: string | null;
}

const snapshotSchema = z
  .object({
    state: z.enum(["open", "closed"]),
    mergedAt: z.iso.datetime({ offset: true }).nullable(),
    targetBranch: z.string().min(1),
    observedAt: z.iso.datetime({ offset: true }),
  })
  .refine((value) => value.mergedAt === null || value.state === "closed");

export async function evaluateTask(
  input: TaskDefinition,
  read: PullRequestReader,
) {
  const task = taskSchema.parse(input);
  const mode = "all" in task.completion ? "all" : "any";
  const rules =
    "all" in task.completion ? task.completion.all : task.completion.any;
  const conditions: ConditionResult[] = [];
  // 외부 API에 한꺼번에 요청을 보내지 않도록 순차 조회한다.
  for (const { pull_request: condition } of rules) {
    const base = {
      condition,
      url: `https://github.com/${condition.repository}/pull/${condition.number}`,
    };
    try {
      const snapshot = snapshotSchema.parse(
        await read(condition.repository, condition.number),
      );
      const satisfied =
        snapshot.mergedAt !== null &&
        snapshot.targetBranch === condition.target_branch;
      conditions.push({
        ...base,
        state: satisfied ? "satisfied" : "unsatisfied",
        reason: satisfied
          ? "지정 브랜치로 머지 완료"
          : snapshot.targetBranch !== condition.target_branch
            ? "머지 대상 브랜치 불일치"
            : snapshot.state === "open"
              ? "머지 대기"
              : "머지 없이 종료",
        observedAt: snapshot.observedAt,
        mergedAt: snapshot.mergedAt,
      });
    } catch {
      conditions.push({
        ...base,
        state: "unknown",
        reason: "PR 조회 또는 응답 검증 실패",
        observedAt: null,
        mergedAt: null,
      });
    }
  }
  const states = conditions.map((condition) => condition.state);
  const state: ResultState =
    mode === "all"
      ? states.includes("unsatisfied")
        ? "unsatisfied"
        : states.includes("unknown")
          ? "unknown"
          : "satisfied"
      : states.includes("satisfied")
        ? "satisfied"
        : states.includes("unknown")
          ? "unknown"
          : "unsatisfied";
  return {
    task: task.task,
    project: task.project,
    feature: task.feature,
    mode,
    state,
    conditions,
  };
}
