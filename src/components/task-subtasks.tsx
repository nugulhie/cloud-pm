"use client";
import { useMemo, useState } from "react";
import { taskHierarchyIndex } from "../core/task-hierarchy";
import type { Stored, Task } from "../core/model";
import TaskCompletionCheckbox from "./task-completion-checkbox";
const states = {
  backlog: "대기",
  ready: "준비 완료",
  in_progress: "진행 중",
  in_review: "리뷰 중",
  done: "완료",
  canceled: "취소",
};

export default function TaskSubtasks({
  task,
  tasks,
  writable,
  busy,
  onOpen,
  onAdd,
  onMove,
  notice,
}: {
  task: Stored<Task>;
  tasks: Stored<Task>[];
  writable: boolean;
  busy: boolean;
  onOpen: (task: Stored<Task>) => void;
  onAdd: (task: Stored<Task>) => void;
  onMove: (task: Stored<Task>, status: Task["status"]) => Promise<void>;
  notice?: string;
}) {
  const index = useMemo(() => taskHierarchyIndex(tasks), [tasks]);
  const children = index.children.get(task.data.id) ?? [];
  const parent = task.data.parentId
    ? index.byId.get(task.data.parentId)
    : undefined;
  const [limit, setLimit] = useState(10);
  return (
    <section className="task-subtasks" aria-label="하위 태스크 관리">
      {parent && (
        <button
          type="button"
          className="text-button"
          onClick={() => onOpen(parent)}
        >
          ↖ 상위 태스크: {parent.data.title}
        </button>
      )}
      <div className="task-subtasks-heading">
        <h3>
          하위 태스크{" "}
          <span>
            {children.filter((child) => child.data.status === "done").length} /{" "}
            {children.length} 완료
          </span>
        </h3>
        <button
          type="button"
          className="button secondary"
          disabled={!writable || busy}
          onClick={() => onAdd(task)}
        >
          ＋ 하위 태스크 추가
        </button>
      </div>
      <p className="muted">
        상위와 하위의 상태는 각각 관리합니다. 하위 작업에서도 더 세부적인
        태스크를 추가할 수 있습니다.
      </p>
      {notice && (
        <p className="alert" role="alert">
          {notice}
        </p>
      )}
      <ul className="task-subtasks-list">
        {children.slice(0, limit).map((child) => (
          <li key={child.data.id}>
            <TaskCompletionCheckbox
              task={child}
              writable={writable}
              busy={busy}
              onMove={onMove}
            />
            <button
              type="button"
              className="task-subtask-open"
              onClick={() => onOpen(child)}
            >
              <strong>{child.data.title}</strong>
              <small>
                {states[child.data.status]} ·{" "}
                {child.data.assignee || "담당자 미지정"} ·{" "}
                {child.data.dueDate || "기한 없음"}
              </small>
            </button>
            <button
              type="button"
              className="text-button"
              disabled={!writable || busy}
              aria-label={`${child.data.title} 하위 태스크 추가`}
              onClick={() => onAdd(child)}
            >
              ＋ 하위
            </button>
          </li>
        ))}
      </ul>
      {!children.length && (
        <p className="muted">아직 하위 태스크가 없습니다.</p>
      )}
      {children.length > limit && (
        <button
          type="button"
          className="text-button"
          onClick={() => setLimit(limit + 10)}
        >
          하위 태스크 더 보기 ({limit} / {children.length})
        </button>
      )}
    </section>
  );
}
