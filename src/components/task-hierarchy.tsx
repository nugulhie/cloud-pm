"use client";
import { TaskGitHubBadges } from "./task-github-connections";
import type { GitHubItem } from "../core/model";
import { useMemo, useState, type CSSProperties } from "react";
import {
  taskHierarchyIndex,
  visibleTaskHierarchy,
} from "../core/task-hierarchy";
import type { Stored, Task } from "../core/model";
import TaskCompletionCheckbox from "./task-completion-checkbox";
import DependencyBadge from "./dependency-badge";
import { TaskAssignee, TaskDueDate, TaskStatusSelect } from "./task-display";

export default function TaskHierarchy({
  tasks,
  relatedTasks,
  projectNames = new Map<string, string>(),
  githubConnections = new Map(),
  showProject = true,
  writable,
  busy,
  onOpen,
  onMove,
  onAddSubtask,
}: {
  tasks: Stored<Task>[];
  relatedTasks: Stored<Task>[];
  projectNames?: ReadonlyMap<string, string>;
  githubConnections?: ReadonlyMap<string, GitHubItem[]>;
  showProject?: boolean;
  writable: boolean;
  busy: boolean;
  onOpen: (task: Stored<Task>) => void;
  onMove: (task: Stored<Task>, status: Task["status"]) => Promise<void>;
  onAddSubtask: (task: Stored<Task>) => void;
}) {
  const index = useMemo(() => taskHierarchyIndex(tasks), [tasks]);
  const context = useMemo(
    () => taskHierarchyIndex(relatedTasks),
    [relatedTasks],
  );
  const dependencyTasks = useMemo(
    () => relatedTasks.map((row) => row.data),
    [relatedTasks],
  );
  const [expanded, setExpanded] = useState(new Set<string>());
  const [limits, setLimits] = useState(new Map<string, number>());
  const [rootLimit, setRootLimit] = useState(50);
  const rows = visibleTaskHierarchy(index, expanded, limits, rootLimit);
  const toggle = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <section className="task-hierarchy" aria-label="태스크 계층 보기">
      <div className="task-hierarchy-header" aria-hidden="true">
        <span>태스크 · 하위 작업</span>
        <span>상태</span>
        <span>담당자</span>
        <span>기한</span>
        <span />
      </div>
      <ul className="task-hierarchy-list" aria-label="태스크 계층 목록">
        {rows.map((row) =>
          row.kind === "more" ? (
            <li
              key={`more-${row.parentId}`}
              className="task-hierarchy-more"
              style={{ paddingInlineStart: Math.min(row.depth, 8) * 14 + 12 }}
            >
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  setLimits((previous) =>
                    new Map(previous).set(row.parentId, row.shown + 50),
                  )
                }
              >
                하위 태스크 50개 더 보기 ({row.shown} / {row.total})
              </button>
            </li>
          ) : (
            (() => {
              const task = row.task,
                id = task.data.id;
              const children = context.children.get(id) ?? [];
              const visibleChildren = index.children.get(id) ?? [];
              const parent = task.data.parentId
                ? context.byId.get(task.data.parentId)
                : undefined;
              return (
                <li
                  key={id}
                  className={`task-hierarchy-row${children.length ? " has-children" : ""}`}
                  data-task-id={id}
                  data-depth={row.depth}
                  style={
                    { "--task-depth": Math.min(row.depth, 8) } as CSSProperties
                  }
                >
                  <div className="task-hierarchy-main">
                    <button
                      className="hierarchy-toggle"
                      disabled={!visibleChildren.length}
                      aria-expanded={
                        visibleChildren.length ? expanded.has(id) : undefined
                      }
                      aria-label={`${task.data.title} 하위 태스크 ${expanded.has(id) ? "접기" : "펼치기"}`}
                      onClick={() => toggle(id)}
                    >
                      {visibleChildren.length
                        ? expanded.has(id)
                          ? "▾"
                          : "▸"
                        : "·"}
                    </button>
                    <label className="task-complete-hit">
                      <TaskCompletionCheckbox
                        task={task}
                        writable={writable}
                        busy={busy}
                        onMove={onMove}
                      />
                    </label>
                    <div className="task-hierarchy-name">
                      <button
                        className="task-hierarchy-title"
                        onClick={() => onOpen(task)}
                      >
                        <strong>{task.data.title}</strong>
                        {row.depth > 4 && (
                          <small className="task-depth-label">
                            하위 {row.depth}단계
                          </small>
                        )}
                        {showProject && (
                          <small className="task-project-name">
                            {projectNames.get(task.data.project) ??
                              task.data.project}
                          </small>
                        )}
                        {row.depth === 0 && parent && (
                          <small>상위: {parent.data.title}</small>
                        )}
                      </button>
                      <TaskGitHubBadges items={githubConnections.get(id)} />
                      {task.data.blockedReason && (
                        <small className="task-blocked-reason">
                          차단 · {task.data.blockedReason}
                        </small>
                      )}
                      {!!task.data.dependsOn?.length && (
                        <DependencyBadge
                          task={task.data}
                          tasks={dependencyTasks}
                        />
                      )}
                      {children.length > 0 && (
                        <button
                          className="text-button hierarchy-progress"
                          onClick={() => onOpen(task)}
                        >
                          하위{" "}
                          {
                            children.filter(
                              (child) => child.data.status === "done",
                            ).length
                          }{" "}
                          / {children.length}개 완료
                        </button>
                      )}
                      {children.length > visibleChildren.length && (
                        <small className="filtered-child-note">
                          필터로 하위 {children.length - visibleChildren.length}
                          개 숨김
                        </small>
                      )}
                    </div>
                  </div>
                  <div className="task-hierarchy-state">
                    <TaskStatusSelect
                      task={task}
                      writable={writable}
                      busy={busy}
                      onMove={onMove}
                    />
                  </div>
                  <div className="task-hierarchy-person">
                    <TaskAssignee name={task.data.assignee} />
                  </div>
                  <div className="task-hierarchy-due">
                    <TaskDueDate task={task.data} />
                  </div>
                  <button
                    className="text-button hierarchy-add"
                    disabled={!writable || busy}
                    aria-label={`${task.data.title} 하위 태스크 추가`}
                    onClick={() => onAddSubtask(task)}
                  >
                    ＋ 하위
                  </button>
                </li>
              );
            })()
          ),
        )}
      </ul>
      {!rows.length && <div className="empty">표시할 태스크가 없습니다.</div>}
      {index.roots.length > rootLimit && (
        <button
          className="button secondary"
          onClick={() => setRootLimit(rootLimit + 50)}
        >
          최상위 태스크 50개 더 보기 ({rootLimit} / {index.roots.length})
        </button>
      )}
    </section>
  );
}
