"use client";
import { useMemo, useState } from "react";
import type { Project, Stored, Task } from "../core/model";

export default function ProjectOverview({
  projects,
  tasks,
  relatedTasks,
  selected,
  scoped,
  writable,
  busy,
  onSelect,
  onManage,
  onDelete,
}: {
  projects: Stored<Project>[];
  tasks: Stored<Task>[];
  relatedTasks: Stored<Task>[];
  selected: string;
  scoped: boolean;
  writable: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onManage: () => void;
  onDelete: (project: Stored<Project>) => void;
}) {
  const [limit, setLimit] = useState(6);
  const summaries = useMemo(() => {
    const byId = new Map(relatedTasks.map((row) => [row.data.id, row.data]));
    const grouped = new Map<
      string,
      {
        total: number;
        done: number;
        canceled: number;
        blocked: number;
        people: Set<string>;
      }
    >();
    for (const { data: task } of tasks) {
      const summary = grouped.get(task.project) ?? {
        total: 0,
        done: 0,
        canceled: 0,
        blocked: 0,
        people: new Set<string>(),
      };
      summary.total++;
      if (task.status === "done") summary.done++;
      if (task.status === "canceled") summary.canceled++;
      if (task.assignee) summary.people.add(task.assignee);
      if (
        !["done", "canceled"].includes(task.status) &&
        (task.blockedReason ||
          task.dependsOn?.some((id) => {
            const dependency = byId.get(id);
            return (
              !dependency ||
              dependency.project !== task.project ||
              dependency.status !== "done"
            );
          }))
      )
        summary.blocked++;
      grouped.set(task.project, summary);
    }
    return grouped;
  }, [tasks, relatedTasks]);
  const visible = projects.filter(
    (row) => !selected || row.data.id === selected,
  );
  return (
    <section className="project-overview" aria-label="프로젝트별 진행 현황">
      <div className="section-title">
        <div>
          <h2>프로젝트</h2>
          <p className="section-description">
            {scoped
              ? "선택한 검색·필터 범위의 태스크 집계입니다."
              : "프로젝트별 완료율, 담당자와 차단 요인을 확인하세요."}
          </p>
        </div>
        <button
          className="text-button"
          disabled={!writable || busy}
          onClick={onManage}
        >
          프로젝트 관리
        </button>
      </div>
      <div className="projects project-overview-grid">
        {visible.slice(0, limit).map((row) => {
          const project = row.data,
            summary = summaries.get(project.id);
          const total = (summary?.total ?? 0) - (summary?.canceled ?? 0);
          const done = summary?.done ?? 0;
          const percent = total ? Math.round((done / total) * 100) : 0;
          const people = [...(summary?.people ?? [])];
          return (
            <div
              key={project.id}
              className="project-summary"
              data-project-id={project.id}
            >
              <div className="project-summary-details">
                <button
                  className="project-open"
                  onClick={() => onSelect(project.id)}
                >
                  <strong>{project.name}</strong>
                  <span aria-hidden="true">↗</span>
                </button>
                <p className="project-goal">
                  {project.goal || "프로젝트 목표를 등록해 주세요."}
                </p>
                <div className="project-progress-label">
                  <span>
                    {done} / {total}개 완료
                  </span>
                  <strong>{percent}%</strong>
                </div>
                <progress
                  aria-label={`${project.name} 완료율`}
                  max={100}
                  value={percent}
                />
                <div className="project-summary-meta">
                  <span>
                    {project.startDate || "시작일 미정"} ~{" "}
                    {project.endDate || "종료일 미정"}
                  </span>
                  <span className={summary?.blocked ? "project-blocked" : ""}>
                    차단 {summary?.blocked ?? 0}개
                  </span>
                </div>
                <p className="project-people">
                  담당자{" "}
                  {people.length
                    ? `${people.slice(0, 3).join(", ")}${people.length > 3 ? ` 외 ${people.length - 3}명` : ""}`
                    : "미지정"}
                </p>
                <small>
                  {project.repositories.join(" · ") ||
                    "GitHub 저장소 미연결 · 나중에 연결할 수 있습니다."}
                  {summary?.canceled
                    ? ` · 취소 ${summary.canceled}개 제외`
                    : ""}
                </small>
              </div>
              {writable && (
                <button
                  className="button danger project-delete"
                  aria-label={`${project.name} 프로젝트 삭제`}
                  disabled={busy}
                  onClick={() => onDelete(row)}
                >
                  삭제
                </button>
              )}
            </div>
          );
        })}
      </div>
      {!visible.length && (
        <div className="empty">
          프로젝트를 만들어 PRD와 태스크를 관리해 보세요.
        </div>
      )}
      {visible.length > limit && (
        <button className="text-button" onClick={() => setLimit(limit + 6)}>
          프로젝트 더 보기 ({Math.min(limit, visible.length)} / {visible.length}
          )
        </button>
      )}
    </section>
  );
}
