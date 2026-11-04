import { taskDependencyInfo } from "../core/dependencies";
import type { Task } from "../core/model";
export default function DependencyBadge({
  task,
  tasks,
}: {
  task: Task;
  tasks: Task[];
}) {
  const info = taskDependencyInfo(task, tasks);
  if (!info.predecessors.length && !info.successors.length) return null;
  return (
    <span
      className={`dependency-badge${info.blocked ? " dependency-blocked" : ""}`}
    >
      {info.blocked
        ? `선행 대기 ${info.pending.length}개`
        : info.predecessors.length
          ? `선행 ${info.predecessors.filter((p) => p.status === "done").length}/${info.predecessors.length} 완료`
          : ""}
      {info.successors.length > 0 && (
        <span>후행 {info.successors.length}개</span>
      )}
    </span>
  );
}
