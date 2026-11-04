"use client";
import { useRef, useState, type FormEvent } from "react";
import { createId } from "../core/browser-id";
import type { Project, Stored, Task } from "../core/model";
import type { IssuePublication, Requirement } from "../core/requirement-model";
import { requirementTaskIds } from "../core/requirement-model";
import EditorDialog from "./editor-dialog";
import GitHubAssigneeSelect from "./github-assignee-select";
import { TaskAssignee, taskStates } from "./task-display";

type Draft = {
  id: string;
  title: string;
  repository: string;
  assignee: string;
};
export default function RequirementTasksDialog({
  row,
  project,
  tasks,
  publications,
  canWrite,
  api,
  onRefresh,
  onClose,
  onOpenTask,
  onIssue,
}: {
  row: Stored<Requirement>;
  project?: Project;
  tasks: Stored<Task>[];
  publications: Stored<IssuePublication>[];
  canWrite: boolean;
  api: (path: string, body?: unknown) => Promise<any>;
  onRefresh: () => Promise<void>;
  onClose: () => void;
  onOpenTask: (task: Stored<Task>) => void;
  onIssue: (task: Stored<Task>) => void;
}) {
  const draft = (title = row.data.featureName, index = 0): Draft => ({
    id: createId(),
    title,
    repository: project?.repositories[index] ?? "",
    assignee: row.data.assignee,
  });
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const submitting = useRef(false);
  const ids = requirementTaskIds(row.data);
  const linked = tasks.filter((t) => ids.includes(t.data.id));
  const missing = ids.length - linked.length;
  function update(id: string, patch: Partial<Draft>) {
    setDrafts((rows) =>
      rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api("requirements/convert", {
        entries: [{ id: row.data.id, revision: row.revision }],
        tasks: drafts.map((t) => ({ ...t, repository: t.repository || null })),
      });
      setDrafts([]);
      setNotice(
        `${result.results[0]?.createdTasks?.length ?? 0}개 태스크를 추가했습니다. 각 태스크에서 GitHub 이슈를 생성할 수 있습니다.`,
      );
      await onRefresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "태스크를 추가하지 못했습니다.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <EditorDialog title="PRD 개발 태스크" busy={busy} onClose={onClose}>
      <p>
        <strong>{row.data.featureName}</strong>
      </p>
      <p className="muted">
        하나의 요구사항을 담당자·저장소별 태스크로 나누세요. GitHub 이슈는 각
        태스크에 연결됩니다.
      </p>
      <ul className="prd-linked-tasks" aria-label="연결된 개발 태스크">
        {linked.map((task) => {
          const publication = publications.find(
            (p) =>
              p.data.requirement === row.data.id &&
              p.data.task === task.data.id,
          )?.data;
          const uncertain =
            publication &&
            ["publishing", "unknown"].includes(publication.state);
          return (
            <li key={task.data.id}>
              <div>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => onOpenTask(task)}
                >
                  {task.data.title}
                </button>
                <small>
                  {task.data.repository ?? "저장소 미지정"} ·{" "}
                  <TaskAssignee name={task.data.assignee} /> ·{" "}
                  {taskStates[task.data.status]}
                </small>
              </div>
              {publication?.state === "created" ? (
                <a href={publication.url} target="_blank" rel="noreferrer">
                  이슈 #{publication.number} ↗
                </a>
              ) : uncertain ? (
                <span className="tag">이슈 원본 확인 필요</span>
              ) : (
                <button
                  type="button"
                  disabled={!canWrite || busy}
                  onClick={() => onIssue(task)}
                >
                  GitHub 이슈 생성
                </button>
              )}
              {publication?.assignmentWarning && (
                <small className="alert">{publication.assignmentWarning}</small>
              )}
            </li>
          );
        })}
      </ul>
      {!linked.length && (
        <p className="empty">아직 연결된 태스크가 없습니다.</p>
      )}
      {missing > 0 && (
        <p className="muted">
          삭제된 연결 태스크 {missing}개는 발행 이력을 위해 보존합니다. 새
          작업은 새 태스크로 추가하세요.
        </p>
      )}
      {canWrite && (
        <form onSubmit={save}>
          <div className="actions">
            <button
              type="button"
              disabled={busy || drafts.length >= 20}
              onClick={() => setDrafts([...drafts, draft()])}
            >
              ＋ 태스크 추가
            </button>
            {!drafts.length && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setDrafts([
                    draft(`${row.data.featureName} · 프론트엔드`),
                    draft(`${row.data.featureName} · 백엔드`, 1),
                  ])
                }
              >
                프론트엔드·백엔드로 나누기
              </button>
            )}
          </div>
          {!!drafts.length && (
            <fieldset disabled={busy} className="prd-task-drafts">
              <legend>추가할 개발 태스크 ({drafts.length}개)</legend>
              {drafts.map((task, index) => (
                <div className="prd-task-draft" key={task.id}>
                  <div className="section-title">
                    <strong>태스크 {index + 1}</strong>
                    <button
                      type="button"
                      onClick={() =>
                        setDrafts(drafts.filter((t) => t.id !== task.id))
                      }
                    >
                      입력 제거
                    </button>
                  </div>
                  <label>
                    태스크 제목
                    <input
                      aria-label={`태스크 ${index + 1} 제목`}
                      required
                      maxLength={300}
                      value={task.title}
                      onChange={(e) =>
                        update(task.id, { title: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    담당 저장소
                    <select
                      aria-label={`태스크 ${index + 1} 저장소`}
                      value={task.repository}
                      onChange={(e) =>
                        update(task.id, {
                          repository: e.target.value,
                          assignee: "",
                        })
                      }
                    >
                      <option value="">나중에 지정</option>
                      {project?.repositories.map((repo) => (
                        <option key={repo} value={repo}>
                          {repo}
                        </option>
                      ))}
                    </select>
                  </label>
                  <GitHubAssigneeSelect
                    key={`${task.id}-${task.repository}`}
                    api={api}
                    project={row.data.project}
                    repository={task.repository || undefined}
                    value={task.assignee}
                    label={`태스크 ${index + 1} 담당자`}
                    onChange={(login) => update(task.id, { assignee: login })}
                  />
                </div>
              ))}
              <p className="muted">
                PRD의 상세설명·정책·비고를 각 태스크에 복사합니다. 이후 태스크와
                이슈는 각각 편집합니다.
              </p>
            </fieldset>
          )}
          {error && (
            <p role="alert" className="alert">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={onClose}
            >
              닫기
            </button>
            {!!drafts.length && (
              <button className="button" disabled={busy}>
                {busy ? "추가 중…" : `${drafts.length}개 태스크 저장`}
              </button>
            )}
          </div>
        </form>
      )}
      {!canWrite && (
        <div className="form-actions">
          <button onClick={onClose}>닫기</button>
        </div>
      )}
    </EditorDialog>
  );
}
