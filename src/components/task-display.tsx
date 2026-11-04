"use client";
import type { Stored, Task } from "../core/model";
import { taskIsOverdue } from "../core/task-date";

export const taskStates: Record<Task["status"], string> = {
  backlog: "대기",
  ready: "준비 완료",
  in_progress: "진행 중",
  in_review: "리뷰 중",
  done: "완료",
  canceled: "취소",
};
export function TaskStatusSelect({
  task,
  writable,
  busy,
  onMove,
}: {
  task: Stored<Task>;
  writable: boolean;
  busy: boolean;
  onMove: (task: Stored<Task>, status: Task["status"]) => Promise<void>;
}) {
  return (
    <select
      className={`list-status task-state-select status-${task.data.status}`}
      aria-label={`${task.data.title} 상태`}
      value={task.data.status}
      disabled={!writable || busy}
      onPointerDown={(event) => event.stopPropagation()}
      onDragStart={(event) => event.preventDefault()}
      onChange={(event) =>
        void onMove(task, event.target.value as Task["status"])
      }
    >
      {Object.entries(taskStates).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}
export function TaskAssignee({ name }: { name: string }) {
  return (
    <span
      className={`task-person${name ? "" : " unassigned"}`}
      title={name || "담당자 미지정"}
    >
      <span className="task-person-avatar" aria-hidden="true">
        {name ? name.slice(0, 1).toUpperCase() : "—"}
      </span>
      <span>{name || "미지정"}</span>
    </span>
  );
}
export function TaskDueDate({ task }: { task: Task }) {
  const overdue = taskIsOverdue(task);
  return (
    <span className={`task-due${overdue ? " overdue" : ""}`}>
      {task.dueDate ? (
        <time dateTime={task.dueDate}>{task.dueDate}</time>
      ) : (
        "기한 없음"
      )}
      {overdue && <small>기한 초과</small>}
    </span>
  );
}
