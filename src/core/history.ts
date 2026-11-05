import { Store } from "../db/store";
import type { Actor, Project, Task, GitHubItem, Stored } from "./model";
export interface ChangeEvent {
  id: string;
  kind: string;
  action: "created" | "updated" | "deleted";
  actor: string;
  target: string;
  targetId: string;
  at: string;
  repository?: string;
  changes: {
    field: string;
    before: string;
    after: string;
    markdown?: boolean;
  }[];
}
const fields: Record<string, string> = {
  featureName: "기능명",
  number: "넘버링",
  sourceId: "원본 ID",
  featurePrefix: "기능 식별자",
  source: "CSV 원본 정보",
  policy: "정책",
  remarks: "비고",
  editor: "편집자",
  taskId: "연결 태스크",
  taskIds: "연결 태스크 목록",
  repository: "담당 저장소",
  content: "내용",
  category: "분류",
  aliases: "별칭",
  owner: "담당자",
  policyIds: "관련 정책",
  glossaryIds: "관련 용어",
  startDate: "시작일",
  endDate: "종료일",
  name: "이름",
  goal: "목표",
  acceptanceCriteria: "인수 기준",
  type: "작업 유형",
  parentId: "상위 태스크",
  dependsOn: "선행 태스크",
  repositories: "연결 저장소",
  title: "제목",
  assignee: "담당자",
  assigneeUserId: "담당 계정",
  estimatedHours: "예상 공수 (시간)",
  storyPoints: "스토리 포인트",
  sprintId: "스프린트",
  assignees: "담당자",
  reviewers: "리뷰 요청",
  status: "상태",
  state: "상태",
  priority: "우선순위",
  dueDate: "기한",
  blockedReason: "차단 사유",
  description: "설명",
  yaml: "완료 조건",
  project: "프로젝트",
  feature: "기능",
  body: "본문",
  files: "변경 파일",
  headSha: "PR 커밋",
  ci: "CI 검사",
  author: "작성자",
  reason: "연결 근거",
  item: "GitHub 항목",
  task: "태스크",
  errors: "오류",
  warnings: "참고 사항",
  finishedAt: "완료 시각",
};
const states: Record<string, string> = {
  active: "사용 중",
  deprecated: "사용 중단",
  draft: "초안",
  completed: "완료",
  on_hold: "보류",
  feature: "기능 개발",
  bug: "버그",
  improvement: "개선",
  operations: "운영",
  backlog: "대기",
  ready: "준비 완료",
  in_progress: "진행 중",
  in_review: "리뷰 중",
  done: "완료",
  canceled: "취소",
  approved: "승인",
  rejected: "거절",
  suggested: "제안",
  open: "열림",
  closed: "닫힘",
  merged: "머지 완료",
  satisfied: "충족",
  unsatisfied: "미충족",
  unknown: "미확인",
  high: "높음",
  medium: "보통",
  low: "낮음",
};
function text(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "미지정";
  if (key === "yaml") return "YAML 조건 등록";
  if (key === "files" && Array.isArray(value)) return `${value.length}개 파일`;
  if (key === "files" && typeof value === "number") return `${value}개 파일`;
  if (key === "headSha" && typeof value === "string") return value.slice(0, 12);
  if (key === "ci" && typeof value === "object")
    return (
      states[(value as { state: string }).state] ??
      String((value as { state: string }).state)
    );
  if (Array.isArray(value))
    return value.length ? value.map(String).join(", ") : "없음";
  if (typeof value === "object") return "상세 내용 변경";
  const t = states[String(value)] ?? String(value);
  return t.length > 250 ? t.slice(0, 250) + "…" : t;
}
// Select the recent event IDs before reading JSON; never window over diff payloads.
const historySnapshot = (alias: "e" | "p") => `CASE WHEN ${alias}.kind='github'
  THEN (${alias}.data->'value') - 'files' ||
    CASE WHEN jsonb_typeof(${alias}.data->'value'->'files')='array'
      THEN jsonb_build_object('files',jsonb_array_length(${alias}.data->'value'->'files'))
      ELSE '{}'::jsonb END
  ELSE ${alias}.data->'value' END`;
export const changeHistoryQuery = `WITH recent AS MATERIALIZED (
  SELECT id,workspace_id,kind,entity_id,actor,created_at
  FROM events
  WHERE (workspace_id=$1 OR (workspace_id='main' AND kind='github'))
    AND kind IN ('project','feature','requirement','knowledge','task','github','link','sync','evaluation')
  ORDER BY created_at DESC,id DESC LIMIT 300
)
SELECT r.id,r.kind,r.entity_id,r.actor,r.created_at,
  ${historySnapshot("e")} AS value,previous.value AS previous
FROM recent r JOIN events e ON e.id=r.id
LEFT JOIN LATERAL (
  SELECT ${historySnapshot("p")} AS value
  FROM events p
  WHERE p.workspace_id=r.workspace_id AND p.kind=r.kind AND p.entity_id=r.entity_id
    AND (COALESCE((p.data->>'revision')::bigint,0),p.created_at,p.id)
      < (COALESCE((e.data->>'revision')::bigint,0),r.created_at,r.id)
  ORDER BY COALESCE((p.data->>'revision')::bigint,0) DESC,p.created_at DESC,p.id DESC
  LIMIT 1
) previous ON true
ORDER BY r.created_at DESC,r.id DESC`;

export async function changeHistory(
  store: Store,
  actor: Actor,
  visible: {
    projects: Stored<Project>[];
    tasks: Stored<Task>[];
    items: Stored<GitHubItem>[];
  },
) {
  const projects = new Set(visible.projects.map((p) => p.data.id)),
    tasks = new Set(visible.tasks.map((t) => t.data.id)),
    items = new Set(visible.items.map((i) => i.data.id));
  const rows = await store.query<{
    id: string;
    kind: string;
    entity_id: string;
    actor: string;
    created_at: string;
    value: Record<string, unknown>;
    previous: Record<string, unknown> | null;
  }>(changeHistoryQuery, [store.workspaceId]);
  const names = new Map(
    (
      await store.query<{ login: string; display_name: string }>(
        "SELECT login,display_name FROM app_users",
      )
    ).map((u) => [u.login, u.display_name]),
  );
  const result: ChangeEvent[] = [];
  for (const row of rows) {
    const v = row.value ?? {};
    if (actor.repositories) {
      const allowed =
        row.kind === "project"
          ? projects.has(row.entity_id) ||
            (v._deleted === true &&
              Array.isArray(v.repositories) &&
              v.repositories.every((r) =>
                actor.repositories!.includes(String(r).toLowerCase()),
              ))
          : ["task", "evaluation"].includes(row.kind)
            ? tasks.has(String(v.task ?? row.entity_id)) ||
              (row.kind === "task" &&
                v._deleted === true &&
                projects.has(String(v.project)))
            : row.kind === "knowledge"
              ? true
              : ["feature", "requirement"].includes(row.kind)
                ? projects.has(String(v.project))
                : row.kind === "github"
                  ? items.has(row.entity_id)
                  : row.kind === "link"
                    ? tasks.has(String(v.task)) && items.has(String(v.item))
                    : row.kind === "sync"
                      ? v.userId === actor.userId
                      : false;
      if (!allowed) continue;
      const repos = new Set(actor.repositories);
      const safeSnapshot = (snapshot: Record<string, unknown>) =>
        row.kind === "project"
          ? Array.isArray(snapshot.repositories) &&
            snapshot.repositories.every((r) =>
              repos.has(String(r).toLowerCase()),
            )
          : ["task", "feature", "requirement"].includes(row.kind)
            ? projects.has(String(snapshot.project))
            : row.kind === "github"
              ? repos.has(String(snapshot.repository).toLowerCase())
              : row.kind === "link"
                ? tasks.has(String(snapshot.task)) &&
                  items.has(String(snapshot.item))
                : true;
      if (!safeSnapshot(v) || (row.previous && !safeSnapshot(row.previous)))
        continue;
    }
    if (
      ![
        "project",
        "feature",
        "requirement",
        "knowledge",
        "task",
        "github",
        "link",
        "sync",
        "evaluation",
      ].includes(row.kind)
    )
      continue;
    const changes = Object.entries(fields)
      .filter(
        ([key]) =>
          key in v &&
          JSON.stringify(v[key]) !== JSON.stringify(row.previous?.[key]),
      )
      .map(([key, label]) => ({
        field:
          row.kind === "knowledge" && key === "dependsOn" ? "의존 정책" : label,
        before: [
          "body",
          "description",
          "goal",
          "acceptanceCriteria",
          "content",
          "policy",
          "remarks",
        ].includes(key)
          ? String(row.previous?.[key] ?? "")
          : text(key, row.previous?.[key]),
        after: [
          "body",
          "description",
          "goal",
          "acceptanceCriteria",
          "content",
          "policy",
          "remarks",
        ].includes(key)
          ? String(v[key] ?? "")
          : text(key, v[key]),
        markdown: [
          "body",
          "description",
          "goal",
          "acceptanceCriteria",
          "content",
          "policy",
          "remarks",
        ].includes(key),
      }));
    if (!changes.length && row.previous && !v._deleted) continue;
    result.push({
      id: row.id,
      kind: row.kind,
      action: v._deleted ? "deleted" : row.previous ? "updated" : "created",
      repository: typeof v.repository === "string" ? v.repository : undefined,
      actor:
        names.get(row.actor) ??
        {
          "initial-github-connection": "GitHub 최초 연결",
          "scheduled-sync": "정기 동기화",
          "webhook-worker": "GitHub 웹훅",
          "demo-seed": "데모 초기화",
        }[row.actor] ??
        row.actor,
      target: String(
        v.title ??
          v.featureName ??
          v.name ??
          v.task ??
          {
            sync: "GitHub 동기화",
            link: "태스크 연결",
            evaluation: "완료 조건 평가",
          }[row.kind] ??
          row.entity_id,
      ),
      targetId: row.entity_id,
      at: new Date(row.created_at).toISOString(),
      changes,
    });
    if (result.length === 100) break;
  }
  return result;
}
