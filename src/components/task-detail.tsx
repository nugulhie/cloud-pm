import type { GitHubItem, Project, Stored, Task } from "../core/model";
import { taskTypes } from "../core/model";
import { TaskAssignee, TaskDueDate, TaskStatusSelect } from "./task-display";
import TaskGitHubConnections from "./task-github-connections";
import MarkdownBody from "./markdown-body";

export default function TaskDetail({
  task,
  project,
  tasks,
  items,
  writable,
  busy,
  onMove,
  onOpen,
}: {
  task: Stored<Task>;
  project?: Project;
  tasks: Stored<Task>[];
  items: GitHubItem[];
  writable: boolean;
  busy: boolean;
  onMove: (task: Stored<Task>, status: Task["status"]) => Promise<void>;
  onOpen: (task: Stored<Task>) => void;
}) {
  const value = task.data;
  const byId = new Map(tasks.map((row) => [row.data.id, row]));
  return (
    <div className="task-read-view">
      <p className="task-detail-project">
        {project?.name ?? value.project} · {taskTypes[value.type ?? "feature"]}
      </p>
      <h3 className="task-detail-title">{value.title}</h3>
      <dl className="task-detail-meta">
        <div>
          <dt>상태</dt>
          <dd>
            <TaskStatusSelect
              task={task}
              writable={writable}
              busy={busy}
              onMove={onMove}
            />
          </dd>
        </div>
        <div>
          <dt>담당자</dt>
          <dd>
            <TaskAssignee name={value.assignee} />
          </dd>
        </div>
        <div>
          <dt>기한</dt>
          <dd>
            <TaskDueDate task={value} />
          </dd>
        </div>
        <div>
          <dt>우선순위</dt>
          <dd>
            {{ low: "낮음", medium: "보통", high: "높음" }[value.priority]}
          </dd>
        </div>
      </dl>
      {value.blockedReason && (
        <p className="task-detail-blocker">차단 사유 · {value.blockedReason}</p>
      )}
      <section className="task-detail-description" aria-label="태스크 설명">
        <h3>설명</h3>
        {value.description ? (
          <MarkdownBody
            body={value.description}
            repository={project?.repositories[0] ?? ""}
          />
        ) : (
          <p className="section-description">등록된 설명이 없습니다.</p>
        )}
      </section>
      <TaskGitHubConnections items={items} />
      {!!value.dependsOn?.length && (
        <section className="task-detail-dependencies" aria-label="선행 태스크">
          <h3>선행 태스크</h3>
          <ul>
            {value.dependsOn.map((id) => {
              const dependency = byId.get(id);
              return (
                <li key={id}>
                  {dependency ? (
                    <button
                      className="text-button"
                      onClick={() => onOpen(dependency)}
                    >
                      {dependency.data.title}
                      <span>
                        {dependency.data.status === "done"
                          ? "완료"
                          : "선행 대기"}
                      </span>
                    </button>
                  ) : (
                    <span>조회할 수 없는 선행 태스크</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <details className="task-detail-reference">
        <summary>식별자·완료 조건 확인</summary>
        <p>
          태스크 ID: <code>{value.id}</code>
        </p>
        <p className="section-description">
          상태에서 직접 완료할 수 있으며, 저장소에 등록한 PR 머지 조건으로도
          자동 완료됩니다.
        </p>
        {value.yaml && <pre>{value.yaml}</pre>}
      </details>
    </div>
  );
}
