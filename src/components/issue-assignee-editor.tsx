"use client";
import { useEffect, useRef, useState } from "react";
import type { GitHubItem, Project, Stored, Task } from "../core/model";
import type { Link } from "../core/service";
import type { PlanningApi } from "./planning-hooks";
export default function IssueAssigneeEditor({
  item,
  projects,
  tasks,
  links,
  api,
  canWrite,
  onChanged,
}: {
  item: GitHubItem;
  projects: Stored<Project>[];
  tasks: Stored<Task>[];
  links: Stored<Link>[];
  api: PlanningApi;
  canWrite: boolean;
  onChanged: (item: GitHubItem) => Promise<void>;
}) {
  const project = projects.find((p) =>
      p.data.repositories.includes(item.repository),
    ),
    [users, setUsers] = useState<string[]>([]),
    [selected, setSelected] = useState(item.assignees),
    [baseline, setBaseline] = useState(item.updatedAt),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [query, setQuery] = useState(""),
    [taskId, setTaskId] = useState(""),
    [reload, setReload] = useState(0);
  const active = useRef(false),
    apiRef = useRef(api);
  apiRef.current = api;
  useEffect(() => {
    if (!dirty) {
      setSelected(item.assignees);
      setBaseline(item.updatedAt);
    }
  }, [item.updatedAt, dirty]);
  useEffect(() => {
    let mounted = true;
    setError("");
    if (!project || item.kind !== "issue" || !canWrite) return;
    void apiRef
      .current(
        `github/assignees?${new URLSearchParams({ project: project.data.id, repository: item.repository })}`,
      )
      .then((v) => {
        if (mounted) setUsers(v.users.map((u: { login: string }) => u.login));
      })
      .catch((e) => {
        if (mounted) setError(e.message);
      });
    return () => {
      mounted = false;
    };
  }, [project?.data.id, item.repository, reload]);
  if (item.kind !== "issue" || !canWrite || !project) return null;
  const linked = tasks.filter((t) =>
    links.some(
      (l) =>
        l.data.task === t.data.id &&
        l.data.item === item.id &&
        l.data.status === "approved",
    ),
  );
  const stale = item.updatedAt !== baseline;
  return (
    <details className="issue-assignee-editor">
      <summary>GitHub 이슈 담당자 변경</summary>
      <p className="muted">
        GitHub 원본의 담당자를 변경하거나 해제합니다. 내부 태스크 변경은
        아래에서 별도로 선택하세요.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (active.current || stale) return;
          active.current = true;
          setBusy(true);
          setError("");
          setNotice("");
          try {
            const task = tasks.find((t) => t.data.id === taskId),
              result = await api("github/issue-assignees", {
                item: item.id,
                assignees: selected,
                expectedUpdatedAt: baseline,
                ...(task
                  ? { task: { id: task.data.id, revision: task.revision } }
                  : {}),
              });
            setSelected(result.item.assignees);
            setBaseline(result.item.updatedAt);
            setDirty(false);
            setNotice(result.warning ?? "GitHub 이슈 담당자를 변경했습니다.");
            await onChanged(result.item);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            active.current = false;
            setBusy(false);
          }
        }}
      >
        <label>
          GitHub 담당자 검색
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="GitHub 아이디"
            disabled={busy}
          />
        </label>
        <fieldset className="issue-assignee-options" disabled={busy || stale}>
          <legend>담당자 선택 ({selected.length}/10)</legend>
          {[...new Set([...selected, ...users])]
            .filter((login) =>
              login.toLowerCase().includes(query.toLowerCase()),
            )
            .map((login) => (
              <label key={login}>
                <input
                  type="checkbox"
                  checked={selected.some(
                    (s) => s.toLowerCase() === login.toLowerCase(),
                  )}
                  disabled={!selected.includes(login) && selected.length >= 10}
                  onChange={(e) => {
                    setDirty(true);
                    setSelected((old) =>
                      e.target.checked
                        ? [...old, login]
                        : old.filter(
                            (s) => s.toLowerCase() !== login.toLowerCase(),
                          ),
                    );
                  }}
                />
                @{login}
                {!users.includes(login) && <small> · 기존 담당자</small>}
              </label>
            ))}
        </fieldset>
        <div className="actions">
          <button
            type="button"
            disabled={busy || stale}
            onClick={() => {
              setDirty(true);
              setSelected([]);
            }}
          >
            모두 해제
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setSelected(item.assignees);
              setBaseline(item.updatedAt);
              setDirty(false);
              setReload((v) => v + 1);
            }}
          >
            최신 선택 다시 불러오기
          </button>
        </div>
        {!!linked.length && (
          <label>
            내부 태스크 담당자도 변경
            <select
              value={taskId}
              aria-label="내부 태스크 담당자도 변경"
              onChange={(e) => setTaskId(e.target.value)}
              disabled={busy}
            >
              <option value="">GitHub 원본만 변경</option>
              {linked.map((t) => (
                <option key={t.data.id} value={t.data.id}>
                  {t.data.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {taskId && selected.length > 1 && (
          <p role="alert">
            내부 태스크를 함께 변경할 때는 담당자를 한 명만 선택하세요.
          </p>
        )}
        {stale && (
          <p role="alert" className="alert">
            편집 중 GitHub 원본이 변경되었습니다. 최신 선택을 다시 불러온 뒤
            확인하세요.
          </p>
        )}
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="success-note">
            {notice}
          </p>
        )}
        <button
          className="button"
          disabled={busy || stale || (!!taskId && selected.length > 1)}
        >
          {busy ? "GitHub에 반영 중…" : "GitHub 담당자 저장"}
        </button>
      </form>
    </details>
  );
}
