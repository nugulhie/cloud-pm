"use client";
import { useState } from "react";
import { taskDependencyInfo } from "../core/dependencies";
import type { Stored, Task } from "../core/model";
const labels = {
  backlog: "대기",
  ready: "준비 완료",
  in_progress: "진행 중",
  in_review: "리뷰 중",
  done: "완료",
  canceled: "취소",
};
export default function TaskDependencies({
  task,
  tasks,
  initial = [],
  writable,
}: {
  task: Pick<Task, "id" | "project" | "status">;
  tasks: Stored<Task>[];
  initial?: string[];
  writable: boolean;
}) {
  const [selected, setSelected] = useState(initial),
    [search, setSearch] = useState("");
  const candidates = tasks.filter(
    (row) => row.data.id !== task.id && row.data.project === task.project,
  );
  const info = taskDependencyInfo(
    {
      ...task,
      feature: "",
      title: "",
      description: "",
      assignee: "",
      priority: "medium",
      dueDate: null,
      blockedReason: "",
      yaml: "",
      dependsOn: selected,
    },
    tasks.map((t) => t.data),
  );
  return (
    <fieldset className="dependency-editor" aria-label="태스크 의존관계">
      <legend>선행·후행 작업</legend>
      <p className="section-description">
        선행 작업이 완료되면 차단 표시가 해제됩니다. 취소된 선행 작업은 관계를
        직접 해제하세요. 완료는 직접 처리하거나 각 태스크의 YAML PR 머지
        조건으로 판단합니다.
      </p>
      {selected.map((id) => (
        <input key={id} type="hidden" name="dependsOn" value={id} />
      ))}
      <div className="discussion-heading">
        <strong>
          {info.pending.length
            ? `미완료 선행 작업 ${info.pending.length}개`
            : selected.length
              ? "선행 작업 조건 충족"
              : "선행 작업 없음"}
        </strong>
        <button
          type="button"
          className="text-button"
          disabled={!writable || !selected.length}
          onClick={() => setSelected([])}
        >
          선행 작업 모두 해제
        </button>
      </div>
      {!!info.predecessors.length && (
        <ul className="selected-dependencies" aria-label="선택된 선행 작업">
          {info.predecessors.map((p) => (
            <li key={p.id}>
              <span>
                {p.title}
                <small>
                  {p.id} · {p.status ? labels[p.status] : "조회 불가"}
                </small>
              </span>
              <button
                type="button"
                className="text-button"
                aria-label={`${p.title} 선행 관계 해제`}
                disabled={!writable}
                onClick={() =>
                  setSelected((ids) => ids.filter((id) => id !== p.id))
                }
              >
                해제
              </button>
            </li>
          ))}
        </ul>
      )}
      <label>
        선행 작업 검색
        <input
          aria-label="선행 작업 검색"
          value={search}
          placeholder="제목 또는 식별자"
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div
        className="dependency-options"
        role="group"
        aria-label="선행 작업 선택"
      >
        {candidates
          .filter((row) =>
            `${row.data.id} ${row.data.title}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .map(({ data: candidate }) => (
            <label className="dependency-option" key={candidate.id}>
              <input
                type="checkbox"
                aria-label={`선행 작업 ${candidate.title} (${candidate.id})`}
                checked={selected.includes(candidate.id)}
                disabled={
                  !writable ||
                  (!selected.includes(candidate.id) && selected.length >= 100)
                }
                onChange={(e) =>
                  setSelected((ids) =>
                    e.target.checked
                      ? [...ids, candidate.id]
                      : ids.filter((id) => id !== candidate.id),
                  )
                }
              />
              <span>
                <strong>{candidate.title}</strong>
                <small>
                  {candidate.id} · {labels[candidate.status]}
                </small>
              </span>
            </label>
          ))}
        {!candidates.length && (
          <p className="empty small">
            같은 프로젝트에 등록된 다른 태스크가 없습니다.
          </p>
        )}
        {selected
          .filter((id) => !candidates.some((row) => row.data.id === id))
          .map((id) => (
            <label className="dependency-option" key={id}>
              <input
                type="checkbox"
                checked
                disabled={!writable}
                onChange={() =>
                  setSelected((ids) => ids.filter((value) => value !== id))
                }
              />
              <span>조회할 수 없는 선행 작업 ({id})</span>
            </label>
          ))}
      </div>
      <small>
        최대 100개 · 선택 {selected.length}개 · 저장 버튼을 눌러 반영합니다.
      </small>
      {info.successors.length > 0 && (
        <div className="dependency-successors">
          <strong>
            이 작업을 기다리는 후행 작업 ({info.successors.length})
          </strong>
          <ul>
            {info.successors.map((t) => (
              <li key={t.id}>
                {t.title} ({t.id}) · {labels[t.status]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </fieldset>
  );
}
