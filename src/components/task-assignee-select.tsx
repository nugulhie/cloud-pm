"use client";
import { useEffect, useRef, useState } from "react";
import type { PlanningPerson } from "../core/planning-model";
import GitHubAssigneeSelect from "./github-assignee-select";
export default function TaskAssigneeSelect({
  api,
  project,
  defaultAssignee = "",
  defaultUserId,
}: {
  api: (path: string, body?: unknown) => Promise<any>;
  project: string;
  defaultAssignee?: string;
  defaultUserId?: string | null;
}) {
  const [members, setMembers] = useState<PlanningPerson[]>([]),
    [selected, setSelected] = useState(defaultUserId ?? ""),
    [external, setExternal] = useState(!!defaultAssignee && !defaultUserId),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [next, setNext] = useState<number | null>(null);
  const apiRef = useRef(api);
  apiRef.current = api;
  async function load(offset = 0) {
    setLoading(true);
    setError("");
    try {
      const result = await apiRef.current(
        `planning/people?${new URLSearchParams({ project, offset: String(offset), limit: "100" })}`,
      );
      setMembers((old) => (offset ? [...old, ...result.items] : result.items));
      setNext(result.nextOffset);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    setMembers([]);
    setLoading(true);
    void apiRef
      .current(
        `planning/people?${new URLSearchParams({ project, limit: "100" })}`,
      )
      .then((result) => {
        if (active) {
          setMembers(result.items);
          setNext(result.nextOffset);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [project]);
  const member = members.find((m) => m.id === selected);
  if (!loading && !members.length && !defaultUserId)
    return (
      <>
        <input type="hidden" name="assigneeAccountMode" value="github" />
        <GitHubAssigneeSelect
          api={api}
          project={project}
          defaultValue={defaultAssignee}
        />
        {error && (
          <small className="muted">서비스 계정 목록 조회 실패: {error}</small>
        )}
      </>
    );
  return (
    <div className="task-account-assignee">
      <input
        type="hidden"
        name="assigneeAccountMode"
        value={external ? "github" : "account"}
      />
      <input
        type="hidden"
        name="assigneeUserId"
        value={external ? "" : selected}
      />
      {!external && (
        <input
          type="hidden"
          name="assignee"
          value={
            member?.githubLogin ??
            member?.login ??
            (selected ? defaultAssignee : "")
          }
        />
      )}
      <label>
        담당자
        <select
          aria-label="담당자"
          value={external ? "__github" : selected}
          disabled={loading}
          onChange={(e) => {
            setExternal(e.target.value === "__github");
            setSelected(e.target.value === "__github" ? "" : e.target.value);
          }}
        >
          <option value="">미지정</option>
          {selected && !member && (
            <option value={selected}>
              {defaultAssignee || "기존 담당 계정"}
            </option>
          )}
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName} · @{m.githubLogin ?? m.login}
            </option>
          ))}
          <option value="__github">GitHub 사용자에서 선택…</option>
        </select>
      </label>
      {external && (
        <GitHubAssigneeSelect
          api={api}
          project={project}
          defaultValue={defaultAssignee}
          label="GitHub 담당자"
        />
      )}
      {next !== null && (
        <button
          type="button"
          disabled={loading}
          onClick={() => void load(next)}
        >
          담당 계정 더 불러오기
        </button>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
