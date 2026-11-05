"use client";
import { TaskGitHubBadges } from "./task-github-connections";
import type { GitHubItem } from "../core/model";
import DependencyBadge from "./dependency-badge";
import TaskHierarchy from "./task-hierarchy";
import {
  TaskAssignee,
  TaskDueDate,
  TaskStatusSelect,
  taskStates,
} from "./task-display";
import { taskHierarchyIndex } from "../core/task-hierarchy";
import { isDependencyBlocked } from "../core/dependencies";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { taskTypes, type Project, type Stored, type Task } from "../core/model";

export default function TaskBoard({
  tasks: allTasks,
  relatedTasks,
  projects = [],
  githubConnections = new Map(),
  showProject = true,
  busy,
  writable,
  onOpen,
  onMove,
  onDragging,
  onAddSubtask,
  filterBar,
  extraFilters,
  externalFilterCount = 0,
  searchActive = false,
  onResetFilters,
  filters: controlledFilters,
  onFiltersChange,
}: {
  tasks: Stored<Task>[];
  relatedTasks?: Stored<Task>[];
  projects?: Stored<Project>[];
  githubConnections?: ReadonlyMap<string, GitHubItem[]>;
  showProject?: boolean;
  busy: boolean;
  writable: boolean;
  onOpen: (task: Stored<Task>) => void;
  onMove: (task: Stored<Task>, status: Task["status"]) => Promise<void>;
  onDragging: (active: boolean) => void;
  onAddSubtask: (task: Stored<Task>) => void;
  filterBar?: ReactNode;
  extraFilters?: ReactNode;
  externalFilterCount?: number;
  searchActive?: boolean;
  onResetFilters?: () => void;
  filters?: {
    type: string;
    blockedOnly: boolean;
    view: "board" | "list" | "hierarchy";
  };
  onFiltersChange?: (filters: {
    type: string;
    blockedOnly: boolean;
    view: "board" | "list" | "hierarchy";
  }) => void;
}) {
  const contextTasks = relatedTasks ?? allTasks;
  const context = useMemo(
    () => taskHierarchyIndex(contextTasks),
    [contextTasks],
  );
  const dependencyTasks = useMemo(
    () => contextTasks.map((row) => row.data),
    [contextTasks],
  );
  const projectNames = useMemo(
    () => new Map(projects.map((row) => [row.data.id, row.data.name])),
    [projects],
  );
  const [showCanceled, setShowCanceled] = useState(false);
  const [localBlockedOnly, setLocalBlockedOnly] = useState(false);
  const [localTypeFilter, setLocalTypeFilter] = useState("");
  const blockedOnly = controlledFilters?.blockedOnly ?? localBlockedOnly;
  const typeFilter = controlledFilters?.type ?? localTypeFilter;
  const setBlockedOnly = (value: boolean) =>
    controlledFilters
      ? onFiltersChange?.({ ...controlledFilters, blockedOnly: value })
      : setLocalBlockedOnly(value);
  const setTypeFilter = (value: string) =>
    controlledFilters
      ? onFiltersChange?.({ ...controlledFilters, type: value })
      : setLocalTypeFilter(value);
  const tasks = allTasks.filter(
    (task) =>
      (!typeFilter || (task.data.type ?? "feature") === typeFilter) &&
      (!blockedOnly || isDependencyBlocked(task.data, dependencyTasks)),
  );
  const [localView, setLocalView] = useState<"board" | "list" | "hierarchy">(
    "hierarchy",
  );
  const view = controlledFilters?.view ?? localView;
  const setView = (value: "board" | "list" | "hierarchy") =>
    controlledFilters
      ? onFiltersChange?.({ ...controlledFilters, view: value })
      : setLocalView(value);
  const [visibleLimit, setVisibleLimit] = useState(50);
  useEffect(() => setVisibleLimit(50), [view, blockedOnly, typeFilter]);
  const [dragging, setDragging] = useState<Stored<Task> | null>(null),
    [over, setOver] = useState<string | null>(null);
  const filterCount =
    externalFilterCount + Number(blockedOnly) + Number(!!typeFilter);
  function reset() {
    setBlockedOnly(false);
    setTypeFilter("");
    onResetFilters?.();
  }
  function stop() {
    setDragging(null);
    setOver(null);
    onDragging(false);
  }
  function allowed(status: Task["status"]) {
    return !!dragging && writable && !busy && status !== dragging.data.status;
  }
  function relation(task: Stored<Task>) {
    const parent = task.data.parentId
      ? context.byId.get(task.data.parentId)
      : undefined;
    const children = context.children.get(task.data.id) ?? [];
    return (
      <span className="task-context">
        {showProject && (
          <span className="task-project-name">
            {projectNames.get(task.data.project) ?? task.data.project}
          </span>
        )}
        {parent && <span>상위: {parent.data.title}</span>}
        {!!children.length && (
          <span>
            하위 작업{" "}
            {children.filter((row) => row.data.status === "done").length}/
            {children.length} 완료
          </span>
        )}
      </span>
    );
  }
  return (
    <section className="task-board-section" aria-label="태스크 작업 공간">
      <div className="task-workspace-toolbar">
        {filterBar}
        <details className="task-filter-menu">
          <summary>필터{filterCount > 0 && <span>{filterCount}</span>}</summary>
          <div className="task-filter-fields">
            {extraFilters}
            <label>
              작업 유형
              <select
                aria-label="작업 유형 필터"
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
              >
                <option value="">모든 작업 유형</option>
                {Object.entries(taskTypes).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="task-blocked-filter">
              <input
                type="checkbox"
                checked={blockedOnly}
                onChange={(event) => setBlockedOnly(event.target.checked)}
              />
              선행 대기만
            </label>
          </div>
        </details>
        {(filterCount > 0 || searchActive) && (
          <button className="text-button task-filter-reset" onClick={reset}>
            검색·필터 초기화
          </button>
        )}
      </div>
      <div className="task-view-toolbar">
        <div className="view-switch" role="group" aria-label="태스크 보기 방식">
          <button
            aria-pressed={view === "hierarchy"}
            onClick={() => setView("hierarchy")}
          >
            계층 보기
          </button>
          <button
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            목록 보기
          </button>
          <button
            aria-pressed={view === "board"}
            onClick={() => setView("board")}
          >
            보드 보기
          </button>
        </div>
        <span className="task-result-count">
          <strong>{tasks.length.toLocaleString()}</strong>개 태스크
        </span>
        <span className="task-view-hint">
          {view === "board"
            ? "드래그 또는 상태 메뉴로 변경"
            : view === "hierarchy"
              ? "화살표를 눌러 하위 작업 펼치기"
              : "제목을 눌러 상세 보기"}
        </span>
      </div>
      {view === "hierarchy" ? (
        <TaskHierarchy
          tasks={tasks}
          relatedTasks={contextTasks}
          projectNames={projectNames}
          githubConnections={githubConnections}
          showProject={showProject}
          writable={writable}
          busy={busy}
          onOpen={onOpen}
          onMove={onMove}
          onAddSubtask={onAddSubtask}
        />
      ) : view === "list" ? (
        <div
          className="task-list-scroll"
          role="region"
          aria-label="태스크 목록"
          tabIndex={0}
        >
          <table className="task-list">
            <thead>
              <tr>
                <th>태스크</th>
                <th>상태</th>
                <th>담당자</th>
                <th>우선순위</th>
                <th>기한</th>
                <th>
                  <span className="sr-only">하위 추가</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tasks.slice(0, visibleLimit).map((task) => (
                <tr key={task.data.id} data-task-id={task.data.id}>
                  <td>
                    <button
                      className="task-list-open"
                      onClick={() => onOpen(task)}
                    >
                      <strong>{task.data.title}</strong>
                      {relation(task)}
                      <TaskGitHubBadges
                        items={githubConnections.get(task.data.id)}
                      />
                      <DependencyBadge
                        task={task.data}
                        tasks={dependencyTasks}
                      />
                    </button>
                  </td>
                  <td>
                    <TaskStatusSelect
                      task={task}
                      writable={writable}
                      busy={busy}
                      onMove={onMove}
                    />
                  </td>
                  <td>
                    <TaskAssignee name={task.data.assignee} />
                  </td>
                  <td>
                    <span className={`priority ${task.data.priority}`}>
                      {
                        { low: "낮음", medium: "보통", high: "높음" }[
                          task.data.priority
                        ]
                      }
                    </span>
                  </td>
                  <td>
                    <TaskDueDate task={task.data} />
                  </td>
                  <td>
                    <button
                      className="text-button task-add-child"
                      disabled={!writable || busy}
                      aria-label={`${task.data.title} 하위 태스크 추가`}
                      onClick={() => onAddSubtask(task)}
                    >
                      ＋ 하위
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!tasks.length && (
            <div className="empty">조건에 맞는 태스크가 없습니다.</div>
          )}
        </div>
      ) : (
        <>
          <div className="board-options">
            <span className="section-description">
              가로로 이동해 다른 상태를 확인하세요.
            </span>
            <label>
              <input
                type="checkbox"
                checked={showCanceled}
                onChange={(event) => setShowCanceled(event.target.checked)}
              />
              취소 열 표시
            </label>
          </div>
          <div
            className="board-scroll"
            role="region"
            aria-label="태스크 상태 보드"
            tabIndex={0}
          >
            <div className="board">
              {(Object.entries(taskStates) as [Task["status"], string][])
                .filter(
                  ([status]) =>
                    status !== "canceled" ||
                    showCanceled ||
                    tasks.some((task) => task.data.status === "canceled"),
                )
                .map(([status, label]) => (
                  <section
                    key={status}
                    aria-label={`${label} 열`}
                    data-status={status}
                    className={`board-column status-${status}${over === status ? " drop-active" : ""}`}
                    onDragOver={(event) => {
                      if (allowed(status)) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setOver(status);
                      }
                    }}
                    onDragLeave={(event) => {
                      if (
                        !event.currentTarget.contains(
                          event.relatedTarget as Node | null,
                        )
                      )
                        setOver(null);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const task = dragging;
                      if (task && allowed(status)) {
                        stop();
                        void onMove(task, status);
                      } else stop();
                    }}
                  >
                    <h3>
                      <span className={`task-dot ${status}`} />
                      {label}
                      <span>
                        {
                          tasks.filter((task) => task.data.status === status)
                            .length
                        }
                      </span>
                    </h3>
                    {tasks
                      .filter((task) => task.data.status === status)
                      .slice(0, visibleLimit)
                      .map((task) => (
                        <article
                          key={task.data.id}
                          data-task-id={task.data.id}
                          className={`task-card${dragging?.data.id === task.data.id ? " dragging" : ""}`}
                          draggable={writable && !busy}
                          onDragStart={(event) => {
                            if (!writable || busy) {
                              event.preventDefault();
                              return;
                            }
                            setDragging(task);
                            onDragging(true);
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData(
                              "text/plain",
                              task.data.id,
                            );
                          }}
                          onDragEnd={stop}
                        >
                          <button
                            className="task-card-open"
                            onClick={() => onOpen(task)}
                          >
                            <strong>{task.data.title}</strong>
                            {relation(task)}
                            <TaskGitHubBadges
                              items={githubConnections.get(task.data.id)}
                            />
                            <DependencyBadge
                              task={task.data}
                              tasks={dependencyTasks}
                            />
                            {task.data.blockedReason && (
                              <p>{task.data.blockedReason}</p>
                            )}
                            <span className="task-card-meta">
                              <TaskAssignee name={task.data.assignee} />
                              <span
                                className={`priority ${task.data.priority}`}
                              >
                                {
                                  { low: "낮음", medium: "보통", high: "높음" }[
                                    task.data.priority
                                  ]
                                }
                              </span>
                            </span>
                            <TaskDueDate task={task.data} />
                          </button>
                          <div className="task-card-actions">
                            <TaskStatusSelect
                              task={task}
                              writable={writable}
                              busy={busy}
                              onMove={onMove}
                            />
                            <button
                              className="text-button task-add-child"
                              disabled={!writable || busy}
                              aria-label={`${task.data.title} 하위 태스크 추가`}
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={() => onAddSubtask(task)}
                            >
                              ＋ 하위
                            </button>
                          </div>
                        </article>
                      ))}
                    {!tasks.some((task) => task.data.status === status) && (
                      <p className="board-empty">이 상태의 작업이 없습니다.</p>
                    )}
                  </section>
                ))}
            </div>
          </div>
        </>
      )}
      {view !== "hierarchy" &&
        (view === "list"
          ? tasks.length > visibleLimit
          : Object.keys(taskStates).some(
              (status) =>
                tasks.filter((task) => task.data.status === status).length >
                visibleLimit,
            )) && (
          <button
            className="button secondary"
            onClick={() => setVisibleLimit(visibleLimit + 50)}
          >
            {view === "list" ? "작업 50개 더 보기" : "상태별 작업 50개 더 보기"}
          </button>
        )}
    </section>
  );
}
