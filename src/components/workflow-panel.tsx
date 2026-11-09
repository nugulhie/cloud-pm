"use client";
import { useState } from "react";
import { createId } from "../core/browser-id";
import type { Stored, Task, Project } from "../core/model";
import type {
  ChangeReview,
  TaskReview,
  Milestone,
  Release,
} from "../core/review-model";
import type { PlanningPerson } from "../core/planning-model";
import {
  usePlanningData,
  usePlanningAction,
  type PlanningApi,
} from "./planning-hooks";
import { draftSaved } from "./draft-boundary";
import EditorDialog from "./editor-dialog";
import TaskTimeline from "./task-timeline";
import ReferencePicker from "./reference-picker";
import MarkdownBody from "./markdown-body";
import { taskToday } from "../core/task-date";
const fieldNames: Record<string, string> = {
  name: "정책·용어명",
  content: "본문",
  status: "상태",
  dependsOn: "기준 정책",
  featureName: "기능명",
  description: "상세설명",
  policy: "정책",
  policyIds: "관련 정책",
  glossaryIds: "관련 용어",
  remarks: "비고",
};
type Props = {
  api: PlanningApi;
  project: string;
  projects: Stored<Project>[];
  tasks: Stored<Task>[];
  canWrite: boolean;
  viewerId: string | null;
  admin: boolean;
  onOpen: (id: string) => void;
  refresh: () => Promise<void>;
  summaryPeriod?: "day" | "week" | "current";
  onSummaryPeriodChange?: (period: "day" | "week" | "current") => void;
  view?: string;
  onViewChange?: (view: string) => void;
};
export default function WorkflowPanel(props: Props) {
  const [localTab, setLocalTab] = useState("변경 검토");
  const tab = props.view ?? localTab,
    setTab = props.onViewChange ?? setLocalTab;
  return (
    <section className="workflow-panel" aria-label="검토와 릴리스">
      <div className="view-switch" role="group" aria-label="검토·릴리스 보기">
        {["변경 검토", "기획 검수", "일정·릴리스", "PM 요약"].map((name) => (
          <button
            key={name}
            aria-pressed={tab === name}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      {tab === "변경 검토" ? (
        <Changes {...props} />
      ) : tab === "기획 검수" ? (
        <Reviews {...props} />
      ) : tab === "일정·릴리스" ? (
        <Schedule {...props} />
      ) : (
        <Summary {...props} />
      )}
    </section>
  );
}
function Changes({ api, project, tasks, canWrite, refresh }: Props) {
  const [offset, setOffset] = useState(0);
  const query = usePlanningData<{
      nextOffset: number | null;
      items: (Stored<ChangeReview> & {
        sourceCurrentRevision: number | null;
      })[];
    }>(
      api,
      `workflow/changes?offset=${offset}${project ? `&project=${project}` : ""}`,
    ),
    people = usePlanningData<{ items: PlanningPerson[] }>(
      api,
      "planning/people?limit=100",
    ),
    action = usePlanningAction(api, async () => {
      query.reload();
      await refresh();
    });
  return (
    <>
      <h2>정책·PRD 변경 검토</h2>
      <p className="muted">
        변경 전후와 영향받는 요구사항·작업을 확인하고 담당자와 검토 결과를
        기록합니다.
      </p>
      <Feedback error={query.error || action.error} notice={action.notice} />
      {query.loading && <p role="status">변경 검토를 불러오는 중…</p>}
      {query.data && !query.data.items.length && (
        <p className="empty">
          검토할 변경이 없습니다. 정책이나 PRD 내용이 바뀌면 검토 항목이
          생성됩니다.
        </p>
      )}
      {query.data?.items.map((row) => (
        <ChangeCard
          key={row.data.id}
          row={row}
          tasks={tasks}
          people={people.data?.items ?? []}
          canWrite={canWrite}
          busy={action.busy}
          save={(body) =>
            action.mutate(
              "workflow/changes/update",
              body,
              "검토 결과를 저장했습니다.",
            )
          }
        />
      ))}
      <div className="actions">
        <button
          disabled={!offset || action.busy}
          onClick={() => setOffset(Math.max(0, offset - 20))}
        >
          이전 변경
        </button>
        <button
          disabled={query.data?.nextOffset == null || action.busy}
          onClick={() => setOffset(query.data!.nextOffset!)}
        >
          다음 변경
        </button>
      </div>
    </>
  );
}
function ChangeCard({
  row,
  tasks,
  people,
  canWrite,
  busy,
  save,
}: {
  row: Stored<ChangeReview> & { sourceCurrentRevision: number | null };
  tasks: Stored<Task>[];
  people: PlanningPerson[];
  canWrite: boolean;
  busy: boolean;
  save: (body: unknown) => Promise<boolean>;
}) {
  const [limit, setLimit] = useState(20),
    stale = row.sourceCurrentRevision !== row.data.sourceRevision;
  return (
    <article className="workflow-card">
      <div className="section-title">
        <h3>{row.data.title}</h3>
        <span className="badge">
          미검토 {row.data.targets.filter((t) => t.status === "pending").length}
          개
        </span>
      </div>
      <p className="muted">
        {row.data.author} ·{" "}
        {new Date(row.data.createdAt).toLocaleString("ko-KR")}
        {stale && " · 후속 변경 있음: 최신 검토를 사용하세요."}
      </p>
      <details>
        <summary>변경 전후 비교</summary>
        <table className="workflow-diff">
          <thead>
            <tr>
              <th>항목</th>
              <th>변경 전</th>
              <th>변경 후</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(row.data.after)
              .filter(
                (k) =>
                  JSON.stringify(row.data.after[k]) !==
                  JSON.stringify(row.data.before[k]),
              )
              .map((key) => (
                <tr key={key}>
                  <th>{fieldNames[key] ?? key}</th>
                  <td>
                    <MarkdownBody
                      repository=""
                      body={valueText(row.data.before[key])}
                    />
                  </td>
                  <td>
                    <MarkdownBody
                      repository=""
                      body={valueText(row.data.after[key])}
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
      {row.data.targets.slice(0, limit).map((target) => (
        <form
          key={`${target.kind}:${target.id}`}
          className="change-target"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget),
              task = tasks.find((t) => t.data.id === target.id),
              status = String(f.get("status"));
            await save({
              id: row.data.id,
              revision: row.revision,
              target: target.id,
              kind: target.kind,
              note: String(f.get("note") ?? ""),
              status,
              ...(f.get("reviewerId")
                ? { reviewerId: String(f.get("reviewerId")) }
                : {}),
              ...(status === "applied" && task
                ? {
                    targetRevision: task.revision,
                    patch: { description: String(f.get("description") ?? "") },
                  }
                : {}),
            });
          }}
        >
          <fieldset disabled={!canWrite || busy || stale}>
            <legend>
              {target.kind === "task" ? "태스크" : "PRD"} · {target.title}
            </legend>
            <div className="form-grid">
              <label>
                검토 담당자
                <select
                  name="reviewerId"
                  defaultValue={target.reviewerId ?? ""}
                >
                  <option value="">기존 담당자 유지</option>
                  {people
                    .filter((p) => p.role !== "viewer")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.displayName}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                검토 상태
                <select name="status" defaultValue={target.status}>
                  <option value="pending">검토 대기</option>
                  <option value="reviewed">검토 완료</option>
                  {target.kind === "task" && (
                    <option value="applied">태스크 설명에 선택 반영</option>
                  )}
                </select>
              </label>
            </div>
            <label>
              검토 메모
              <input name="note" defaultValue={target.note} maxLength={2000} />
            </label>
            {target.kind === "task" && (
              <details>
                <summary>태스크 설명 반영 내용</summary>
                <p className="muted">
                  검토 상태에서 ‘선택 반영’을 고른 경우에만 아래 설명을
                  저장합니다.
                </p>
                <textarea
                  name="description"
                  maxLength={8000}
                  defaultValue={
                    row.data.sourceKind === "requirement"
                      ? String(row.data.after.description ?? "")
                      : (tasks.find((t) => t.data.id === target.id)?.data
                          .description ?? "")
                  }
                />
              </details>
            )}
            <button className="button secondary">검토 저장</button>
          </fieldset>
        </form>
      ))}
      {row.data.targets.length > limit && (
        <button onClick={() => setLimit(limit + 20)}>검토 대상 더 보기</button>
      )}
    </article>
  );
}
function Reviews({
  api,
  project,
  tasks,
  canWrite,
  refresh,
  viewerId,
  admin,
  onOpen,
}: Props) {
  const query = usePlanningData<{
      items: (Stored<TaskReview> & { stale: boolean })[];
    }>(api, `workflow/reviews${project ? `?project=${project}` : ""}`),
    people = usePlanningData<{ items: PlanningPerson[] }>(
      api,
      "planning/people?limit=100",
    ),
    action = usePlanningAction(api, async () => {
      query.reload();
      await refresh();
    });
  return (
    <>
      <h2>기획 검수</h2>
      <p className="muted">
        개발 완료 상태와 별도로 기획 확인을 기록합니다. 승인 이후 작업이
        수정되면 다시 검수를 요청합니다.
      </p>
      <Feedback error={query.error || action.error} notice={action.notice} />
      <form
        className="workflow-card"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            task = tasks.find((t) => t.data.id === f.get("task"))!;
          await action.mutate(
            "workflow/reviews/request",
            {
              task: task.data.id,
              taskRevision: task.revision,
              reviewerId: f.get("reviewerId"),
              revision: query.data?.items.find(
                (r) => r.data.task === task.data.id,
              )?.revision,
              note: String(f.get("note") ?? ""),
            },
            "기획 검수를 요청했습니다.",
          );
        }}
      >
        <fieldset disabled={!canWrite || action.busy}>
          <legend>검수 요청</legend>
          <div className="form-grid">
            <label>
              완료한 태스크
              <select name="task" required>
                <option value="">태스크 선택</option>
                {tasks
                  .filter(
                    (t) =>
                      t.data.status === "done" &&
                      (!project || t.data.project === project),
                  )
                  .map((t) => (
                    <option key={t.data.id} value={t.data.id}>
                      {t.data.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              검수 담당자
              <select name="reviewerId" required>
                <option value="">멤버 선택</option>
                {people.data?.items
                  .filter((p) => p.role !== "viewer")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <label>
            확인할 내용
            <textarea name="note" maxLength={2000} />
          </label>
          <button className="button">기획 검수 요청</button>
        </fieldset>
      </form>
      {query.data?.items.map((row) => (
        <article key={row.data.id} className="workflow-card">
          <div className="section-title">
            <button
              className="text-button"
              onClick={() => onOpen(row.data.task)}
            >
              {tasks.find((t) => t.data.id === row.data.task)?.data.title ??
                row.data.task}
            </button>
            <span className="badge">
              {row.stale
                ? "작업 수정됨 · 재검수 필요"
                : { pending: "검수 대기", approved: "승인", rejected: "반려" }[
                    row.data.status
                  ]}
            </span>
          </div>
          <p>{row.data.note}</p>
          <p className="muted">
            요청자 {row.data.requestedBy} ·{" "}
            {people.data?.items.find((p) => p.id === row.data.reviewerId)
              ?.displayName ?? "검수자"}
          </p>
          {row.data.decidedBy && (
            <p className="muted">
              처리: {row.data.decidedBy} ·{" "}
              {new Date(row.data.decidedAt!).toLocaleString("ko-KR")}
            </p>
          )}
          {row.data.status === "pending" && !row.stale && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await action.mutate(
                  "workflow/reviews/decide",
                  {
                    id: row.data.id,
                    revision: row.revision,
                    status: f.get("decision"),
                    note: f.get("note"),
                  },
                  "검수 결과를 기록했습니다.",
                );
              }}
            >
              <fieldset
                disabled={
                  !canWrite ||
                  action.busy ||
                  (!admin && viewerId !== row.data.reviewerId)
                }
              >
                <label>
                  검수 결과
                  <select name="decision">
                    <option value="approved">승인</option>
                    <option value="rejected">반려</option>
                  </select>
                </label>
                <label>
                  검수 근거·보완 내용
                  <textarea name="note" required maxLength={2000} />
                </label>
                <button className="button secondary">검수 결과 기록</button>
              </fieldset>
            </form>
          )}
        </article>
      ))}
    </>
  );
}
function Schedule(props: Props) {
  const { api, project, projects, tasks, canWrite, refresh, onOpen } = props;
  const milestones = usePlanningData<{ items: Stored<Milestone>[] }>(
      api,
      `workflow/milestones${project ? `?project=${project}` : ""}`,
    ),
    releases = usePlanningData<{ items: Stored<Release>[] }>(
      api,
      `workflow/releases${project ? `?project=${project}` : ""}`,
    ),
    action = usePlanningAction(api, async () => {
      milestones.reload();
      releases.reload();
      await refresh();
    });
  const [editing, setEditing] = useState<{
      kind: "milestone" | "release";
      row?: Stored<any>;
    } | null>(null),
    [formProject, setFormProject] = useState(
      project || projects[0]?.data.id || "",
    ),
    [preview, setPreview] = useState<any>(null),
    [selected, setSelected] = useState<string[]>([]),
    [limit, setLimit] = useState(50);
  const scopedTasks = tasks.filter(
    (t) => !project || t.data.project === project,
  );
  return (
    <>
      <div className="section-title">
        <h2>일정·릴리스</h2>
        <div className="actions">
          <button
            disabled={!canWrite}
            onClick={() => {
              setFormProject(project || projects[0]?.data.id || "");
              setEditing({ kind: "milestone" });
            }}
          >
            마일스톤 추가
          </button>
          <button
            className="button"
            disabled={!canWrite}
            onClick={() => {
              setFormProject(project || projects[0]?.data.id || "");
              setEditing({ kind: "release" });
            }}
          >
            릴리스 계획 추가
          </button>
        </div>
      </div>
      <Feedback
        error={milestones.error || releases.error || action.error}
        notice={action.notice}
      />
      <TaskTimeline tasks={scopedTasks} onOpen={onOpen} />
      <div className="planning-grid-scroll">
        <table>
          <thead>
            <tr>
              <th>태스크</th>
              <th>시작일</th>
              <th>마감일</th>
              <th>담당자</th>
            </tr>
          </thead>
          <tbody>
            {scopedTasks.slice(0, limit).map((t) => (
              <tr key={t.data.id}>
                <td>
                  <button
                    className="text-button"
                    onClick={() => onOpen(t.data.id)}
                  >
                    {t.data.title}
                  </button>
                </td>
                <td>{t.data.startDate ?? "미지정"}</td>
                <td>{t.data.dueDate ?? "미지정"}</td>
                <td>{t.data.assignee || "미지정"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {scopedTasks.length > limit && (
        <button onClick={() => setLimit(limit + 50)}>일정 더 보기</button>
      )}
      <form
        className="workflow-card"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const p = await api("workflow/schedule/preview", {
            task: f.get("task"),
            days: Number(f.get("days")),
          }).catch((error) => {
            setPreview({ error: error.message });
            return null;
          });
          if (p) {
            setPreview(p);
            setSelected(p.changes.map((c: any) => c.id));
          }
        }}
      >
        <fieldset disabled={action.busy}>
          <legend>일정 변경 영향 미리보기</legend>
          <div className="form-grid">
            <label>
              기준 작업
              <select name="task" required>
                <option value="">태스크 선택</option>
                {scopedTasks
                  .filter(
                    (t) =>
                      !["done", "canceled"].includes(t.data.status) &&
                      t.data.dueDate,
                  )
                  .map((t) => (
                    <option key={t.data.id} value={t.data.id}>
                      {t.data.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              변경 일수
              <input
                name="days"
                type="number"
                defaultValue={1}
                min={-365}
                max={365}
                required
              />
            </label>
          </div>
          <button>일정 영향 확인</button>
        </fieldset>
      </form>
      {preview && (
        <div className="workflow-card">
          {preview.error ? (
            <p role="alert">{preview.error}</p>
          ) : (
            <>
              <h3>변경할 일정 선택</h3>
              <p>{preview.policy}</p>
              {preview.changes.map((c: any) => (
                <label className="checkbox" key={c.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(c.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, c.id]
                          : selected.filter((id) => id !== c.id),
                      )
                    }
                  />
                  {c.title} · {c.previousStartDate ?? "미지정"}~
                  {c.previousDueDate} → {c.startDate ?? "미지정"}~{c.dueDate}
                </label>
              ))}
              {preview.unscheduled.length > 0 && (
                <p className="alert">
                  후속 작업 {preview.unscheduled.length}개는 시작일·마감일을
                  먼저 지정해야 합니다.
                </p>
              )}
              <button
                className="button"
                disabled={!canWrite || action.busy || !selected.length}
                onClick={async () => {
                  if (
                    await action.mutate(
                      "workflow/schedule/apply",
                      {
                        task: preview.task,
                        days: preview.days,
                        previewHash: preview.previewHash,
                        selected,
                      },
                      "선택한 일정을 변경했습니다.",
                    )
                  )
                    setPreview(null);
                }}
              >
                선택 일정 반영
              </button>
            </>
          )}
        </div>
      )}
      <h3>마일스톤</h3>
      {milestones.data?.items.map((row) => (
        <article className="workflow-card" key={row.data.id}>
          <strong>{row.data.name}</strong>
          <p>
            목표일 {row.data.targetDate} · 태스크 {row.data.taskIds.length}개
          </p>
          <p>{row.data.description}</p>
          <div className="actions">
            <button
              disabled={!canWrite || action.busy}
              onClick={() => {
                setFormProject(row.data.project);
                setEditing({ kind: "milestone", row });
              }}
            >
              마일스톤 수정
            </button>
            <button
              disabled={!canWrite || action.busy}
              onClick={() =>
                void action.mutate(
                  "workflow/milestones/delete",
                  { id: row.data.id, revision: row.revision },
                  "마일스톤을 휴지통으로 이동했습니다.",
                )
              }
            >
              마일스톤 삭제
            </button>
          </div>
        </article>
      ))}
      <h3>릴리스</h3>
      {releases.data?.items.map((row) => (
        <article className="workflow-card" key={row.data.id}>
          <strong>{row.data.version}</strong>
          <span className="badge">
            {row.data.status === "released" ? "배포 완료" : "배포 계획"}
          </span>
          <p>
            {row.data.environment} · 예정 {row.data.plannedDate} · 실제{" "}
            {row.data.actualDate ?? "미배포"}
          </p>
          {row.data.url && (
            <a href={row.data.url} target="_blank" rel="noreferrer">
              배포 환경 열기
            </a>
          )}
          <MarkdownBody repository="" body={row.data.notes} />
          {row.data.status === "planned" && (
            <div className="actions">
              <button
                disabled={!canWrite || action.busy}
                onClick={() => {
                  setFormProject(row.data.project);
                  setEditing({ kind: "release", row });
                }}
              >
                릴리스 수정·배포 기록
              </button>
              <button
                disabled={!canWrite || action.busy}
                onClick={() =>
                  void action.mutate(
                    "workflow/releases/delete",
                    { id: row.data.id, revision: row.revision },
                    "릴리스 계획을 휴지통으로 이동했습니다.",
                  )
                }
              >
                릴리스 계획 삭제
              </button>
            </div>
          )}
        </article>
      ))}
      {editing && (
        <EditorDialog
          title={editing.kind === "milestone" ? "마일스톤 편집" : "릴리스 편집"}
          draftKey={`${editing.kind}:${editing.row?.data.id ?? "new"}`}
          onDraftRestore={(values) => {
            if (values["@일정 프로젝트"]?.[0])
              setFormProject(values["@일정 프로젝트"][0]);
          }}
          revision={editing.row?.revision}
          busy={action.busy}
          onClose={() => setEditing(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const element = e.currentTarget,
                f = new FormData(element),
                body = {
                  id: editing.row?.data.id ?? createId(),
                  project: formProject,
                  taskIds: f.getAll("taskIds").map(String),
                  revision: editing.row?.revision,
                  ...(editing.kind === "milestone"
                    ? {
                        name: f.get("name"),
                        targetDate: f.get("targetDate"),
                        description: f.get("description"),
                      }
                    : {
                        version: f.get("version"),
                        plannedDate: f.get("plannedDate"),
                        actualDate: f.get("actualDate") || null,
                        milestoneId: f.get("milestoneId") || null,
                        status: f.get("status"),
                        environment: f.get("environment"),
                        url: f.get("url"),
                        notes: f.get("notes"),
                      }),
                };
              if (
                await action.mutate(
                  `workflow/${editing.kind === "milestone" ? "milestones" : "releases"}`,
                  body,
                )
              ) {
                draftSaved(element);
                setEditing(null);
              }
            }}
          >
            <fieldset disabled={action.busy}>
              <label>
                프로젝트
                <select
                  aria-label="일정 프로젝트"
                  value={formProject}
                  disabled={!!editing.row}
                  onChange={(e) => setFormProject(e.target.value)}
                >
                  {projects.map((p) => (
                    <option key={p.data.id} value={p.data.id}>
                      {p.data.name}
                    </option>
                  ))}
                </select>
              </label>
              {editing.kind === "milestone" ? (
                <>
                  <label>
                    마일스톤 이름
                    <input
                      name="name"
                      defaultValue={editing.row?.data.name}
                      required
                      maxLength={200}
                    />
                  </label>
                  <label>
                    목표일
                    <input
                      name="targetDate"
                      type="date"
                      defaultValue={editing.row?.data.targetDate ?? taskToday()}
                      required
                    />
                  </label>
                  <label>
                    설명
                    <textarea
                      name="description"
                      defaultValue={editing.row?.data.description}
                      maxLength={4000}
                    />
                  </label>
                </>
              ) : (
                <>
                  <div className="form-grid">
                    <label>
                      버전
                      <input
                        name="version"
                        defaultValue={editing.row?.data.version}
                        required
                        maxLength={100}
                      />
                    </label>
                    <label>
                      배포 예정일
                      <input
                        name="plannedDate"
                        type="date"
                        defaultValue={
                          editing.row?.data.plannedDate ?? taskToday()
                        }
                        required
                      />
                    </label>
                    <label>
                      배포 상태
                      <select
                        name="status"
                        defaultValue={editing.row?.data.status ?? "planned"}
                      >
                        <option value="planned">계획</option>
                        <option value="released">배포 완료</option>
                      </select>
                    </label>
                    <label>
                      실제 배포일
                      <input
                        name="actualDate"
                        type="date"
                        defaultValue={editing.row?.data.actualDate ?? ""}
                      />
                    </label>
                    <label>
                      배포 환경
                      <input
                        name="environment"
                        defaultValue={
                          editing.row?.data.environment ?? "production"
                        }
                        maxLength={100}
                      />
                    </label>
                    <label>
                      확인 URL
                      <input
                        name="url"
                        type="url"
                        defaultValue={editing.row?.data.url ?? ""}
                      />
                    </label>
                  </div>
                  <label>
                    마일스톤
                    <select
                      name="milestoneId"
                      defaultValue={editing.row?.data.milestoneId ?? ""}
                    >
                      <option value="">연결하지 않음</option>
                      {milestones.data?.items
                        .filter((m) => m.data.project === formProject)
                        .map((m) => (
                          <option key={m.data.id} value={m.data.id}>
                            {m.data.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    배포 설명
                    <textarea
                      name="notes"
                      defaultValue={editing.row?.data.notes ?? ""}
                      maxLength={8000}
                    />
                  </label>
                  <p className="muted">
                    배포 완료 기록에는 포함된 모든 태스크의 현재 버전 기획
                    승인이 필요합니다.
                  </p>
                </>
              )}
              <ReferencePicker
                key={formProject}
                name="taskIds"
                label="포함할 태스크"
                buttonLabel="태스크 선택"
                max={500}
                initial={editing.row?.data.taskIds ?? []}
                options={tasks
                  .filter((t) => t.data.project === formProject)
                  .map((t) => ({ id: t.data.id, name: t.data.title }))}
              />
              <Feedback error={action.error} notice="" />
              <div className="form-actions">
                <button
                  type="button"
                  data-draft-close
                  onClick={() => setEditing(null)}
                >
                  취소
                </button>
                <button className="button">저장</button>
              </div>
            </fieldset>
          </form>
        </EditorDialog>
      )}
    </>
  );
}
function Summary({
  api,
  project,
  tasks,
  onOpen,
  summaryPeriod = "day",
  onSummaryPeriodChange,
}: Props) {
  const query = usePlanningData<any>(
    api,
    `workflow/summary?period=${summaryPeriod}${project ? `&project=${project}` : ""}`,
  );
  return (
    <>
      <h2>PM 업무 요약</h2>
      <label>
        요약 기간
        <select
          aria-label="PM 요약 기간"
          value={summaryPeriod}
          onChange={(e) =>
            onSummaryPeriodChange?.(
              e.target.value as "day" | "week" | "current",
            )
          }
        >
          <option value="day">오늘</option>
          <option value="week">이번 주</option>
          <option value="current">현재 전체 현황</option>
        </select>
      </label>
      <p className="muted">
        현재 접근 가능한 업무의 상태를 집계합니다. 기한·차단 사유를 기준으로
        확인할 항목을 보여줍니다.
      </p>
      <Feedback error={query.error} notice="" />
      {query.data && (
        <>
          {query.data.activity && (
            <p className="summary-activity">
              {query.data.range.startDate}~{query.data.range.endDate} · 신규
              등록 {query.data.activity.created}개 · 완료 전환{" "}
              {query.data.activity.completed}개 · 완료 상태로 등록{" "}
              {query.data.activity.registeredDone}개 · 기획 승인{" "}
              {query.data.activity.approved}개
            </p>
          )}
          <div className="pm-summary-counts">
            {Object.entries({
              active: "진행할 작업",
              done: "완료",
              overdue: "기한 초과",
              blocked: "차단·선행 대기",
              unassigned: "담당자 미지정",
            }).map(([key, label]) => (
              <div key={key}>
                <span>{label}</span>
                <strong>{query.data.counts[key]}</strong>
              </div>
            ))}
          </div>
          {[
            ["overdue", "기한을 넘긴 작업"],
            ["blocked", "차단된 작업"],
            ["unassigned", "담당자가 필요한 작업"],
          ].map(([key, title]) => (
            <section key={key}>
              <h3>{title}</h3>
              {query.data[key!].map((id: string) => (
                <p key={id}>
                  <button className="text-button" onClick={() => onOpen(id)}>
                    {tasks.find((t) => t.data.id === id)?.data.title ?? id}
                  </button>
                </p>
              ))}
            </section>
          ))}
          <p className="muted">
            기준 시각 {new Date(query.data.asOf).toLocaleString("ko-KR")}
          </p>
        </>
      )}
    </>
  );
}
function Feedback({ error, notice }: { error: string; notice: string }) {
  return (
    <>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success-note" role="status">
          {notice}
        </p>
      )}
    </>
  );
}
function valueText(value: unknown) {
  return Array.isArray(value)
    ? value.join(", ")
    : value == null || value === ""
      ? "없음"
      : String(value);
}
