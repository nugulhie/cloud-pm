"use client";
import { createId } from "../core/browser-id";
import DeleteConfirmation from "./delete-confirmation";
import BulkCreate from "./bulk-create";
import EditorDialog from "./editor-dialog";
import ProjectPrefixField from "./project-prefix-field";
import GitHubAssigneeSelect from "./github-assignee-select";
import { deletionImpact } from "./deletion-impact";
import { useEffect, useRef, useState } from "react";
import type { Service } from "../core/service";
type Data = Awaited<ReturnType<Service["dashboard"]>>;
export default function ManagementPanel({
  data,
  api,
  refresh,
  initialKind = "project",
  onAddTask,
  onAddProject,
  onEditTask,
  projectFilter = "",
}: {
  onAddTask: () => void;
  onAddProject: () => void;
  onEditTask: (task: Data["tasks"][number]) => void;
  projectFilter?: string;
  initialKind?: "project" | "feature" | "task";
  data: Data;
  api: (path: string, body?: unknown) => Promise<unknown>;
  refresh: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState<{
    kind: "project" | "feature" | "task";
    entries: { id: string; revision: number }[];
    names: string[];
  } | null>(null);
  const [kind, setKind] = useState<"project" | "feature" | "task">(initialKind),
    [selected, setSelected] = useState<string[]>([]),
    [editing, setEditing] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [project, setProject] = useState(data.projects[0]?.data.id ?? ""),
    [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [bulkField, setBulkField] = useState(
    initialKind === "project" ? "startDate" : "assignee",
  );
  const pending = useRef(false);
  useEffect(() => {
    setSelected([]);
    setQuery("");
  }, [projectFilter]);
  const [editSnapshot, setEditSnapshot] =
    useState<(Data["projects"] | Data["features"] | Data["tasks"])[number]>();
  const allRows =
    kind === "project"
      ? data.projects
      : kind === "feature"
        ? data.features
        : data.tasks;
  const rows = allRows.filter(
    ({ data: row }) =>
      (!projectFilter ||
        ("project" in row ? row.project : row.id) === projectFilter) &&
      `${"name" in row ? row.name : row.title} ${row.id} ${"assignee" in row ? row.assignee : ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const checked = rows.filter((row) => selected.includes(row.data.id));
  const assigneeProjects = [
    ...new Set(
      checked.flatMap((row) =>
        "project" in row.data ? [row.data.project] : [],
      ),
    ),
  ];
  const current = editSnapshot;
  async function run(fn: () => Promise<unknown>) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
      setSelected([]);
      setEditing(null);
      setNotice("저장했습니다.");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (data.viewer.role !== "write")
    return (
      <section className="management-panel">
        <h2>프로젝트·작업 관리</h2>
        <p className="section-description">
          조회 전용 권한입니다. 프로젝트 현황·태스크 보드에서 내용을 확인할 수
          있습니다. 수정 권한은 워크스페이스 관리자에게 요청하세요.
        </p>
      </section>
    );
  return (
    <section className="management-panel">
      {deleting && (
        <DeleteConfirmation
          names={deleting.names}
          busy={busy}
          error={error}
          impact={deletionImpact(
            data,
            deleting.kind,
            deleting.entries.map((row) => row.id),
          )}
          onCancel={() => {
            if (!busy) {
              setDeleting(null);
              setError("");
            }
          }}
          onConfirm={async () => {
            const success = await run(() =>
              api("manage/delete", {
                kind: deleting.kind,
                entries: deleting.entries,
              }),
            );
            if (success) {
              setDeleting(null);
              setNotice(`${deleting.entries.length}개 항목을 삭제했습니다.`);
            }
          }}
        />
      )}
      <div className="section-title">
        <h2>프로젝트·작업 관리</h2>
        <select
          aria-label="관리 종류"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as typeof kind);
            setSelected([]);
            setEditing(null);
            setQuery("");
            setBulkField(
              e.target.value === "project" ? "startDate" : "assignee",
            );
          }}
        >
          <option value="project">프로젝트</option>
          <option value="task">태스크</option>
        </select>
      </div>
      <p className="section-description">
        항목을 선택해 일괄 삭제하거나, 각 항목의 수정 버튼을 누르세요.
        프로젝트·상위 태스크를 삭제하면 하위 태스크와 연결도 삭제됩니다. GitHub
        원본은 유지됩니다.
      </p>
      <div className="management-search">
        <input
          aria-label="관리 항목 검색"
          placeholder="이름·식별자·담당자로 검색"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span>
          {rows.length}개 항목
          {projectFilter
            ? ` · ${data.projects.find((row) => row.data.id === projectFilter)?.data.name ?? "선택 프로젝트"}`
            : " · 모든 프로젝트"}
        </span>
        {query && <button onClick={() => setQuery("")}>검색 초기화</button>}
      </div>
      {error && !deleting && editing === null && (
        <div role="alert" className="alert">
          {error}
        </div>
      )}
      {notice && (
        <p className="success-note" role="status">
          {notice}
        </p>
      )}
      <div className="bulk-toolbar">
        <button
          onClick={() => setSelected(rows.slice(0, 100).map((r) => r.data.id))}
        >
          전체 선택 (최대 100개)
        </button>
        <button onClick={() => setSelected([])}>선택 해제</button>
        <span>{checked.length}개 선택</span>
        <button
          className="button danger"
          disabled={busy || !checked.length}
          onClick={() => {
            if (deleting) return;
            const targets = rows.filter((r) => selected.includes(r.data.id));
            setError("");
            setNotice("");
            setDeleting({
              kind,
              entries: targets.map((r) => ({
                id: r.data.id,
                revision: r.revision,
              })),
              names: targets.map((r) =>
                "name" in r.data ? r.data.name : r.data.title,
              ),
            });
          }}
        >
          선택 삭제
        </button>
        {kind === "task" && (
          <button disabled={busy || !data.projects.length} onClick={onAddTask}>
            ＋ 태스크 추가
          </button>
        )}
        {kind !== "task" && (
          <button
            onClick={() => {
              if (kind === "project") onAddProject();
              else {
                setEditSnapshot(undefined);
                setEditing("");
                setProject(projectFilter || data.projects[0]?.data.id || "");
              }
            }}
          >
            ＋ {kind === "feature" ? "기능" : "프로젝트"} 추가
          </button>
        )}
      </div>
      <details className="management-form">
        <summary>선택 항목 일괄 수정</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const field = String(f.get("field"));
            let value: string | null = String(f.get("value") ?? "");
            if (["startDate", "endDate", "dueDate"].includes(field) && !value)
              value = null;
            void run(async () => {
              const result = (await api("manage/update", {
                kind,
                entries: rows
                  .filter((r) => selected.includes(r.data.id))
                  .map((r) => ({ id: r.data.id, revision: r.revision })),
                patch: { [field]: value },
              })) as { results: { id: string; ok: boolean; error?: string }[] };
              const failed = result.results.filter((r) => !r.ok);
              if (failed.length) {
                await refresh();
                throw new Error(
                  `${result.results.length - failed.length}개 수정, ${failed.length}개 실패: ${failed.map((r) => r.error).join(", ")}`,
                );
              }
            });
          }}
        >
          <label>
            변경 필드
            <select
              aria-label="변경 필드"
              name="field"
              value={bulkField}
              onChange={(event) => setBulkField(event.target.value)}
            >
              {(kind === "project"
                ? [
                    ["startDate", "시작일"],
                    ["endDate", "종료일"],
                    ["goal", "목표"],
                  ]
                : kind === "feature"
                  ? [["goal", "목표"]]
                  : [
                      ["assignee", "담당자"],
                      ["priority", "우선순위"],
                      ["dueDate", "기한"],
                      ["status", "상태"],
                    ]
              ).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {bulkField === "assignee" ? (
            <>
              <GitHubAssigneeSelect
                key={`bulk-assignee-${assigneeProjects[0] ?? ""}`}
                api={api}
                project={
                  assigneeProjects.length === 1 ? assigneeProjects[0]! : ""
                }
                name="value"
                label="새 담당자"
                disabled={busy}
              />
              {assigneeProjects.length > 1 && (
                <small>
                  담당자 일괄 지정은 같은 프로젝트의 태스크를 선택하세요.
                </small>
              )}
            </>
          ) : (
            <label>
              {bulkField === "priority"
                ? "새 우선순위"
                : bulkField === "status"
                  ? "새 상태"
                  : "새 값 (빈 값은 제거)"}
              {bulkField === "priority" ? (
                <select name="value" key={bulkField} defaultValue="medium">
                  <option value="low">낮음</option>
                  <option value="medium">보통</option>
                  <option value="high">높음</option>
                </select>
              ) : bulkField === "status" ? (
                <select
                  name="value"
                  aria-label="새 상태"
                  key={bulkField}
                  defaultValue="done"
                >
                  <option value="backlog">대기</option>
                  <option value="ready">준비 완료</option>
                  <option value="in_progress">진행 중</option>
                  <option value="in_review">리뷰 중</option>
                  <option value="done">완료</option>
                  <option value="canceled">취소</option>
                </select>
              ) : (
                <input
                  name="value"
                  key={bulkField}
                  type={
                    ["startDate", "endDate", "dueDate"].includes(bulkField)
                      ? "date"
                      : "text"
                  }
                />
              )}
            </label>
          )}
          <button
            className="button"
            disabled={
              busy ||
              !checked.length ||
              (bulkField === "assignee" && assigneeProjects.length !== 1)
            }
          >
            {busy ? "저장 중…" : `선택 ${checked.length}개 수정`}
          </button>
        </form>
      </details>
      {rows.map((r) => (
        <div className="management-row" key={r.data.id}>
          <label>
            <input
              type="checkbox"
              checked={selected.includes(r.data.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, r.data.id]
                    : selected.filter((id) => id !== r.data.id),
                )
              }
            />
            {"name" in r.data ? r.data.name : r.data.title}
          </label>
          <code>{r.data.id}</code>
          <button
            disabled={busy}
            onClick={() => {
              if (kind === "task") {
                const task = data.tasks.find(
                  (task) => task.data.id === r.data.id,
                );
                if (task) onEditTask(task);
                return;
              }
              setError("");
              setEditSnapshot(r);
              setEditing(r.data.id);
              if ("project" in r.data) setProject(r.data.project);
            }}
          >
            수정
          </button>
          <button
            className="button danger"
            disabled={busy}
            onClick={() => {
              if (deleting) return;
              setError("");
              setNotice("");
              setDeleting({
                kind,
                entries: [{ id: r.data.id, revision: r.revision }],
                names: ["name" in r.data ? r.data.name : r.data.title],
              });
            }}
          >
            삭제
          </button>
        </div>
      ))}
      {!rows.length && (
        <div className="empty empty-state">
          {query
            ? "검색 조건에 맞는 항목이 없습니다."
            : "이 범위에 등록된 항목이 없습니다. 추가 버튼으로 시작하세요."}
        </div>
      )}
      {editing !== null && (
        <EditorDialog
          title={current ? "프로젝트 수정" : "새 항목 등록"}
          busy={busy}
          onClose={() => setEditing(null)}
        >
          <form
            className="management-form"
            key={`${kind}-${editing}`}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const value = (key: string) => String(f.get(key) ?? "");
              void run(async () => {
                const base = current?.data;
                const id = base?.id ?? `${kind}-${createId()}`;
                const input =
                  kind === "project"
                    ? {
                        id,
                        name: value("name"),
                        featurePrefix: value("featurePrefix"),
                        goal: value("goal"),
                        repositories: f.getAll("repositories").map(String),
                        startDate: value("startDate") || null,
                        endDate: value("endDate") || null,
                      }
                    : kind === "feature"
                      ? {
                          id,
                          project,
                          name: value("name"),
                          goal: value("goal"),
                          acceptanceCriteria: value("acceptanceCriteria"),
                        }
                      : {
                          ...base,
                          title: value("name"),
                          description: value("goal"),
                          assignee: value("assignee"),
                          priority: value("priority"),
                          dueDate: value("dueDate") || null,
                        };
                await api(
                  kind === "project"
                    ? "projects"
                    : kind === "feature"
                      ? "features"
                      : "tasks",
                  { data: input, revision: current?.revision },
                );
              });
            }}
          >
            <fieldset className="management-fields" disabled={busy}>
              <label>
                이름
                <input
                  name="name"
                  required
                  autoFocus
                  defaultValue={
                    current &&
                    ("name" in current.data
                      ? current.data.name
                      : current.data.title)
                  }
                />
              </label>
              <label>
                목표·설명
                <textarea
                  name="goal"
                  defaultValue={
                    current &&
                    ("goal" in current.data
                      ? current.data.goal
                      : current.data.description)
                  }
                />
              </label>
              {kind === "feature" && (
                <label>
                  인수 기준 (Markdown)
                  <textarea
                    name="acceptanceCriteria"
                    defaultValue={
                      current && "acceptanceCriteria" in current.data
                        ? current.data.acceptanceCriteria
                        : ""
                    }
                    placeholder="사용자가 확인할 수 있는 결과와 검증 방법을 작성하세요."
                  />
                  <small>
                    기능은 브랜치와 독립적인 작업 묶음입니다. 인수 기준은
                    검토용이며, 완료는 직접 처리하거나 태스크의 PR 머지 조건으로
                    판단합니다.
                  </small>
                </label>
              )}
              {kind === "project" ? (
                <>
                  <ProjectPrefixField
                    projectName={
                      current && "name" in current.data ? current.data.name : ""
                    }
                    seed={current?.data.id ?? "new"}
                    defaultValue={
                      current && "featurePrefix" in current.data
                        ? current.data.featurePrefix
                        : undefined
                    }
                    used={data.projects
                      .filter((row) => row.data.id !== current?.data.id)
                      .flatMap((row) =>
                        row.data.featurePrefix ? [row.data.featurePrefix] : [],
                      )}
                  />
                  <div className="form-grid">
                    <label>
                      시작일
                      <input
                        type="date"
                        name="startDate"
                        defaultValue={
                          current && "startDate" in current.data
                            ? (current.data.startDate ?? "")
                            : ""
                        }
                      />
                    </label>
                    <label>
                      종료일
                      <input
                        type="date"
                        name="endDate"
                        defaultValue={
                          current && "endDate" in current.data
                            ? (current.data.endDate ?? "")
                            : ""
                        }
                      />
                    </label>
                  </div>
                  <fieldset>
                    <legend>연결 저장소</legend>
                    {[
                      ...new Set([
                        ...data.repositories.map((r) => r.data.name),
                        ...data.projects.flatMap((p) => p.data.repositories),
                      ]),
                    ].map((repo) => (
                      <label key={repo}>
                        <input
                          type="checkbox"
                          name="repositories"
                          value={repo}
                          defaultChecked={
                            !!(
                              current &&
                              "repositories" in current.data &&
                              current.data.repositories.includes(repo)
                            )
                          }
                        />
                        {repo}
                      </label>
                    ))}
                  </fieldset>
                </>
              ) : kind === "feature" ? (
                <label>
                  프로젝트
                  <select
                    aria-label="프로젝트"
                    value={project}
                    onChange={(e) => setProject(e.target.value)}
                    required
                    disabled={!!current}
                  >
                    {data.projects.map((p) => (
                      <option key={p.data.id} value={p.data.id}>
                        {p.data.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <GitHubAssigneeSelect
                    api={api}
                    project={
                      current && "project" in current.data
                        ? current.data.project
                        : project
                    }
                    defaultValue={
                      current && "assignee" in current.data
                        ? current.data.assignee
                        : ""
                    }
                  />
                  <label>
                    우선순위
                    <select
                      name="priority"
                      defaultValue={
                        current && "priority" in current.data
                          ? current.data.priority
                          : "medium"
                      }
                    >
                      <option value="low">낮음</option>
                      <option value="medium">보통</option>
                      <option value="high">높음</option>
                    </select>
                  </label>
                  <label>
                    기한
                    <input
                      type="date"
                      name="dueDate"
                      defaultValue={
                        current && "dueDate" in current.data
                          ? (current.data.dueDate ?? "")
                          : ""
                      }
                    />
                  </label>
                </>
              )}
            </fieldset>
            {error && (
              <p role="alert" className="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                취소
              </button>
              <button className="button" disabled={busy}>
                {busy ? "저장 중…" : "저장"}
              </button>
            </div>
          </form>
        </EditorDialog>
      )}
      <BulkCreate
        key={`${kind}-${projectFilter}`}
        kind={kind}
        data={data}
        api={api}
        refresh={refresh}
        preferredProject={projectFilter}
      />
    </section>
  );
}
