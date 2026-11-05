"use client";
import { useState } from "react";
import type { Planning } from "../core/planning";
import type { Sprint } from "../core/planning-model";
import type { Stored, Task } from "../core/model";
import { dayNumber, dayString } from "../core/resources";
import { createId } from "../core/browser-id";
import { taskStates, TaskAssignee } from "./task-display";
import {
  usePlanningAction,
  usePlanningData,
  type PlanningApi,
} from "./planning-hooks";
import EditorDialog from "./editor-dialog";
export default function BacklogSprintPanel({
  api,
  project,
  canWrite,
  tasks,
  onOpenTask,
  onRefresh,
}: {
  api: PlanningApi;
  project: string;
  canWrite: boolean;
  tasks: Stored<Task>[];
  onOpenTask: (t: Stored<Task>) => void;
  onRefresh: () => Promise<void>;
}) {
  const [selectedSprint, setSelectedSprint] = useState(""),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<string[]>([]),
    [target, setTarget] = useState(""),
    [dragged, setDragged] = useState("");
  const [dialog, setDialog] = useState<{
    mode: "edit" | "start" | "close" | "delete";
    sprint: Stored<Sprint> | null;
  } | null>(null);
  const sprints = usePlanningData<Stored<Sprint>[]>(
      api,
      project
        ? `planning/sprints?project=${encodeURIComponent(project)}`
        : null,
    ),
    backlog = usePlanningData<Awaited<ReturnType<Planning["backlog"]>>>(
      api,
      project && !selectedSprint
        ? `planning/backlog?${new URLSearchParams({ project, offset: String(offset), limit: "50" })}`
        : null,
    ),
    sprintTasks = usePlanningData<Awaited<ReturnType<Planning["queryTasks"]>>>(
      api,
      project && selectedSprint ? "planning/tasks/query" : null,
      { filters: { project, sprintId: selectedSprint }, offset, limit: 50 },
    );
  const refresh = async () => {
    sprints.reload();
    backlog.reload();
    sprintTasks.reload();
    await onRefresh();
  };
  const action = usePlanningAction(api, refresh),
    list = selectedSprint ? sprintTasks.data : backlog.data,
    current = sprints.data?.find((s) => s.data.id === selectedSprint);
  const error =
    action.error || sprints.error || backlog.error || sprintTasks.error;
  const choose = (id: string) => {
    setSelectedSprint(id);
    setSelected([]);
    setOffset(0);
    action.clear();
  };
  const open = (id: string) => {
    const task = tasks.find((t) => t.data.id === id);
    if (task) onOpenTask(task);
  };
  const show = (
    mode: "edit" | "start" | "close" | "delete",
    sprint: Stored<Sprint> | null,
  ) => {
    action.clear();
    setDialog({ mode, sprint });
  };
  async function reorder(taskId: string, beforeTaskId: string | null) {
    if (!backlog.data) return;
    await action.mutate(
      "planning/backlog/reorder",
      { project, taskId, beforeTaskId, revision: backlog.data.revision },
      "백로그 순서를 변경했습니다.",
    );
  }
  if (!project)
    return (
      <section className="planning-panel">
        <h2>백로그·스프린트</h2>
        <p className="empty">상단에서 계획할 프로젝트를 선택하세요.</p>
      </section>
    );
  const sprintTasksAll = dialog?.sprint
    ? tasks.filter(
        (t) =>
          t.data.project === project &&
          t.data.sprintId === dialog.sprint!.data.id,
      )
    : [];
  return (
    <section className="planning-panel" aria-label="백로그와 스프린트 계획">
      <div className="section-title">
        <div>
          <h2>백로그·스프린트</h2>
          <p className="muted">
            프로젝트의 작업 우선순위를 정하고 스프린트에 배정하세요. 백로그는
            스프린트가 없는 미완료 작업이며 태스크의 ‘대기’ 상태와 구분합니다.
          </p>
        </div>
        <button
          className="button"
          disabled={!canWrite || action.busy}
          onClick={() => show("edit", null)}
        >
          ＋ 스프린트 만들기
        </button>
      </div>
      {error && !dialog && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {action.notice && !dialog && (
        <p role="status" className="success-note">
          {action.notice}
        </p>
      )}
      <div className="planning-sprint-layout">
        <aside className="planning-sprint-list" aria-label="스프린트 목록">
          <button aria-pressed={!selectedSprint} onClick={() => choose("")}>
            프로젝트 백로그
          </button>
          {sprints.data?.map((s) => (
            <button
              key={s.data.id}
              aria-pressed={selectedSprint === s.data.id}
              onClick={() => choose(s.data.id)}
            >
              <strong>{s.data.name}</strong>
              <small>
                {s.data.startDate} ~ {s.data.endDate}
              </small>
              <span className={`tag sprint-${s.data.status}`}>
                {
                  { planned: "계획", active: "진행 중", closed: "종료" }[
                    s.data.status
                  ]
                }
              </span>
            </button>
          ))}
        </aside>
        <div className="planning-sprint-content">
          <div className="section-title">
            <div>
              <h3>{current?.data.name ?? "프로젝트 백로그"}</h3>
              {current && (
                <p>{current.data.goal || "스프린트 목표를 작성하세요."}</p>
              )}
            </div>
            {current && canWrite && (
              <div className="actions">
                {current.data.status !== "closed" && (
                  <button
                    disabled={action.busy}
                    onClick={() => show("edit", current)}
                  >
                    계획 수정
                  </button>
                )}
                {current.data.status === "planned" && (
                  <>
                    <button
                      disabled={action.busy}
                      onClick={() => show("start", current)}
                    >
                      스프린트 시작
                    </button>
                    <button
                      disabled={action.busy}
                      onClick={() => show("delete", current)}
                    >
                      삭제
                    </button>
                  </>
                )}
                {current.data.status === "active" && (
                  <button
                    disabled={action.busy}
                    onClick={() => show("close", current)}
                  >
                    스프린트 종료
                  </button>
                )}
              </div>
            )}
          </div>
          {current?.data.closure && (
            <p className="success-note">
              종료 시점 · 완료 {current.data.closure.done.length}개 · 취소{" "}
              {current.data.closure.canceled.length}개 · 미완료{" "}
              {current.data.closure.incomplete.length}개 · 완료 공수{" "}
              {current.data.closure.estimatedHours}시간 /{" "}
              {current.data.closure.storyPoints}포인트
            </p>
          )}
          <div className="planning-toolbar">
            <span>{selected.length}개 선택</span>
            <select
              aria-label="선택 태스크 이동 대상"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={!canWrite || action.busy}
            >
              <option value="">프로젝트 백로그</option>
              {sprints.data
                ?.filter((s) => s.data.status !== "closed")
                .map((s) => (
                  <option key={s.data.id} value={s.data.id}>
                    {s.data.name}
                  </option>
                ))}
            </select>
            <button
              disabled={
                !canWrite ||
                action.busy ||
                !selected.length ||
                selected.length > 100
              }
              onClick={async () => {
                const entries = tasks
                  .filter(
                    (t) =>
                      selected.includes(t.data.id) &&
                      t.data.project === project,
                  )
                  .map((t) => ({ id: t.data.id, revision: t.revision }));
                if (
                  await action.mutate(
                    "planning/sprints/assign",
                    { project, sprintId: target || null, entries },
                    `${entries.length}개 태스크 배정을 변경했습니다.`,
                  )
                )
                  setSelected([]);
              }}
            >
              선택 태스크 이동
            </button>
          </div>
          <div className="planning-grid-scroll">
            <table className="planning-backlog-table">
              <thead>
                <tr>
                  <th>선택</th>
                  {!selectedSprint && <th>순서</th>}
                  <th>태스크</th>
                  <th>담당자</th>
                  <th>상태</th>
                  <th>예상 공수</th>
                  <th>포인트</th>
                  <th>일정</th>
                </tr>
              </thead>
              <tbody>
                {list?.items.map((row, index) => (
                  <tr
                    key={row.data.id}
                    draggable={!selectedSprint && canWrite && !action.busy}
                    onDragStart={(e) => {
                      setDragged(row.data.id);
                      e.dataTransfer.setData("text/plain", row.data.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      if (dragged && !selectedSprint) e.preventDefault();
                    }}
                    onDragEnd={() => setDragged("")}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragged && dragged !== row.data.id)
                        void reorder(dragged, row.data.id);
                      setDragged("");
                    }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${row.data.title} 선택`}
                        checked={selected.includes(row.data.id)}
                        onChange={(e) =>
                          setSelected((old) =>
                            e.target.checked
                              ? [...old, row.data.id]
                              : old.filter((id) => id !== row.data.id),
                          )
                        }
                      />
                    </td>
                    {!selectedSprint && (
                      <td>
                        <div className="actions">
                          <button
                            aria-label={`${row.data.title} 위로`}
                            disabled={!canWrite || action.busy || index === 0}
                            onClick={() =>
                              void reorder(
                                row.data.id,
                                list.items[index - 1]!.data.id,
                              )
                            }
                          >
                            ↑
                          </button>
                          <button
                            aria-label={`${row.data.title} 아래로`}
                            disabled={
                              !canWrite ||
                              action.busy ||
                              index === list.items.length - 1
                            }
                            onClick={() =>
                              void action.mutate(
                                "planning/backlog/reorder",
                                async () => {
                                  let before =
                                    list.items[index + 2]?.data.id ?? null;
                                  if (!before && list.hasMore) {
                                    const next = await api(
                                      `planning/backlog?${new URLSearchParams({ project, offset: String(offset + list.items.length), limit: "1" })}`,
                                    );
                                    before = next.items[0]?.data.id ?? null;
                                  }
                                  return {
                                    project,
                                    taskId: row.data.id,
                                    beforeTaskId: before,
                                    revision: backlog.data!.revision,
                                  };
                                },
                                "백로그 순서를 변경했습니다.",
                              )
                            }
                          >
                            ↓
                          </button>
                        </div>
                      </td>
                    )}
                    <td>
                      <button
                        className="text-button"
                        onClick={() => open(row.data.id)}
                      >
                        {row.data.title}
                      </button>
                      {row.data.sprintId && !selectedSprint && (
                        <small>종료 스프린트에서 재개된 작업</small>
                      )}
                    </td>
                    <td>
                      <TaskAssignee
                        name={
                          row.assignedUser?.displayName ?? row.data.assignee
                        }
                      />
                    </td>
                    <td>{taskStates[row.data.status]}</td>
                    <td>
                      {row.data.estimatedHours == null
                        ? "미산정"
                        : `${row.data.estimatedHours}시간`}
                    </td>
                    <td>{row.data.storyPoints ?? "—"}</td>
                    <td>
                      {row.data.startDate ?? "미정"} ~{" "}
                      {row.data.dueDate ?? "미정"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!list?.total && !backlog.loading && !sprintTasks.loading && (
            <p className="empty">이 범위에 계획할 태스크가 없습니다.</p>
          )}
          <div className="actions">
            <button
              disabled={offset === 0 || action.busy}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              이전
            </button>
            <span>전체 {list?.total ?? 0}개 · 최대 50개씩 표시</span>
            <button
              disabled={!list?.hasMore || action.busy}
              onClick={() => setOffset(list!.nextOffset!)}
            >
              다음
            </button>
          </div>
        </div>
      </div>
      {dialog && (
        <EditorDialog
          title={
            dialog.mode === "edit"
              ? dialog.sprint
                ? "스프린트 계획 수정"
                : "스프린트 만들기"
              : dialog.mode === "start"
                ? "스프린트 시작 확인"
                : dialog.mode === "close"
                  ? "스프린트 종료 확인"
                  : "계획 스프린트 삭제"
          }
          busy={action.busy}
          onClose={() => setDialog(null)}
        >
          {dialog.mode === "edit" ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                if (
                  await action.mutate(
                    "planning/sprints",
                    {
                      id: dialog.sprint?.data.id ?? createId(),
                      project,
                      name: String(f.get("name")),
                      goal: String(f.get("goal")),
                      startDate: String(f.get("startDate")),
                      endDate: String(f.get("endDate")),
                      revision: dialog.sprint?.revision ?? 0,
                    },
                    "스프린트 계획을 저장했습니다.",
                  )
                )
                  setDialog(null);
              }}
            >
              <fieldset disabled={action.busy}>
                <label>
                  스프린트 이름
                  <input
                    name="name"
                    required
                    maxLength={100}
                    defaultValue={dialog.sprint?.data.name}
                  />
                </label>
                <label>
                  목표
                  <textarea
                    name="goal"
                    maxLength={2000}
                    defaultValue={dialog.sprint?.data.goal}
                  />
                </label>
                <div className="form-grid">
                  <label>
                    시작일
                    <input
                      name="startDate"
                      type="date"
                      required
                      defaultValue={
                        dialog.sprint?.data.startDate ??
                        dayString(
                          dayNumber(new Date().toISOString().slice(0, 10)),
                        )
                      }
                    />
                  </label>
                  <label>
                    종료일
                    <input
                      name="endDate"
                      type="date"
                      required
                      defaultValue={
                        dialog.sprint?.data.endDate ??
                        dayString(
                          dayNumber(new Date().toISOString().slice(0, 10)) + 13,
                        )
                      }
                    />
                  </label>
                </div>
              </fieldset>
              {action.error && (
                <p role="alert" className="alert">
                  {action.error}
                </p>
              )}
              <div className="form-actions">
                <button
                  type="button"
                  disabled={action.busy}
                  onClick={() => setDialog(null)}
                >
                  취소
                </button>
                <button className="button" disabled={action.busy}>
                  스프린트 저장
                </button>
              </div>
            </form>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const value = {
                  id: dialog.sprint!.data.id,
                  revision: dialog.sprint!.revision,
                  ...(dialog.mode === "close"
                    ? {
                        moveTo:
                          String(new FormData(e.currentTarget).get("moveTo")) ||
                          null,
                      }
                    : {}),
                };
                if (
                  await action.mutate(
                    `planning/sprints/${dialog.mode}`,
                    value,
                    dialog.mode === "close"
                      ? "스프린트를 종료하고 미완료 작업을 이동했습니다."
                      : dialog.mode === "start"
                        ? "스프린트를 시작했습니다."
                        : "계획 스프린트를 삭제했습니다.",
                  )
                ) {
                  if (dialog.mode === "delete") choose("");
                  setDialog(null);
                }
              }}
            >
              <p>
                <strong>{dialog.sprint?.data.name}</strong>
              </p>
              <p>
                {dialog.mode === "start"
                  ? "현재 배정한 태스크를 최초 범위로 기록합니다. 태스크 상태는 유지합니다."
                  : dialog.mode === "delete"
                    ? "스프린트 계획을 삭제하고 연결된 태스크를 프로젝트 백로그로 옮깁니다. 태스크는 삭제하지 않습니다."
                    : `완료 ${sprintTasksAll.filter((t) => t.data.status === "done").length}개, 취소 ${sprintTasksAll.filter((t) => t.data.status === "canceled").length}개를 기록하고 미완료 작업을 이동합니다.`}
              </p>
              {dialog.mode === "close" && (
                <label>
                  미완료 작업 이동 대상
                  <select name="moveTo" disabled={action.busy}>
                    <option value="">프로젝트 백로그</option>
                    {sprints.data
                      ?.filter(
                        (s) =>
                          s.data.status === "planned" &&
                          s.data.id !== dialog.sprint!.data.id,
                      )
                      .map((s) => (
                        <option key={s.data.id} value={s.data.id}>
                          {s.data.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {action.error && (
                <p role="alert" className="alert">
                  {action.error}
                </p>
              )}
              <div className="form-actions">
                <button
                  type="button"
                  disabled={action.busy}
                  onClick={() => setDialog(null)}
                >
                  취소
                </button>
                <button
                  className={`button${dialog.mode === "delete" ? " danger" : ""}`}
                  disabled={action.busy}
                >
                  {dialog.mode === "delete"
                    ? "계획 삭제"
                    : dialog.mode === "start"
                      ? "시작 확인"
                      : "종료 확인"}
                </button>
              </div>
            </form>
          )}
        </EditorDialog>
      )}
    </section>
  );
}
