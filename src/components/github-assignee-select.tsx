"use client";
import { useEffect, useRef, useState } from "react";

type User = { login: string; repositories: string[] };
export default function GitHubAssigneeSelect({
  api,
  project,
  repository,
  defaultValue = "",
  value,
  onChange,
  onValidityChange,
  name = "assignee",
  label = "담당자",
  disabled = false,
}: {
  api: (path: string, body?: unknown) => Promise<any>;
  project: string;
  repository?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (login: string) => void;
  onValidityChange?: (valid: boolean) => void;
  name?: string;
  label?: string;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState(defaultValue),
    [users, setUsers] = useState<User[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [sourceScope, setSourceScope] = useState("project"),
    [reload, setReload] = useState(0);
  const apiRef = useRef(api),
    validRef = useRef(onValidityChange);
  apiRef.current = api;
  validRef.current = onValidityChange;
  const current = value ?? selected;
  const known = users.some(
    (u) => u.login.toLowerCase() === current.toLowerCase(),
  );
  useEffect(() => {
    let active = true;
    setUsers([]);
    setError("");
    if (!project) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const query = new URLSearchParams({
      project,
      ...(repository ? { repository } : {}),
    });
    void apiRef
      .current(`github/assignees?${query}`)
      .then((result) => {
        if (
          !Array.isArray(result.users) ||
          !result.users.every((user: User) => typeof user.login === "string")
        )
          throw new Error(
            "GitHub 담당자 응답 형식을 확인하지 못했습니다. 다시 불러오세요.",
          );
        if (active) setUsers(result.users);
        if (active) setSourceScope(result.scope ?? "project");
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "GitHub 담당자 조회 실패");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [project, repository, reload]);
  useEffect(() => {
    validRef.current?.(!current || (!loading && !error && known));
  }, [current, loading, error, known]);
  return (
    <div className="github-assignee-field">
      <input type="hidden" name={name} value={current} />
      <label>
        {label}
        <select
          aria-label={label}
          value={
            users.find(
              (user) => user.login.toLowerCase() === current.toLowerCase(),
            )?.login ?? current
          }
          disabled={disabled || loading || !project}
          onChange={(event) => {
            setSelected(event.target.value);
            onChange?.(event.target.value);
          }}
        >
          <option value="">미지정</option>
          {current && !known && (
            <option value={current} disabled>
              기존 값: {current} · GitHub 사용자 재선택
            </option>
          )}
          {users.map((user) => (
            <option key={user.login.toLowerCase()} value={user.login}>
              @{user.login}
            </option>
          ))}
        </select>
      </label>
      {loading ? (
        <small role="status">GitHub 담당자 불러오는 중…</small>
      ) : (
        <small>
          {sourceScope === "workspace"
            ? "저장소가 없는 프로젝트는 워크스페이스에 연결된 GitHub 사용자 목록을 사용합니다."
            : "프로젝트 저장소에서 이슈를 배정할 수 있는 GitHub 사용자만 표시합니다."}
        </small>
      )}
      {!loading && !error && project && !users.length && (
        <small>
          배정 가능한 사용자가 없습니다. GitHub 연결과 저장소 접근 권한을
          확인하세요.
        </small>
      )}
      {error && (
        <div className="alert" role="alert">
          {error}{" "}
          <button
            type="button"
            disabled={disabled}
            onClick={() => setReload((n) => n + 1)}
          >
            담당자 다시 불러오기
          </button>
        </div>
      )}
    </div>
  );
}
