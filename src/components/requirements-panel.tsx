"use client";
import { draftSaved } from "./draft-boundary";
import { createId } from "../core/browser-id";
import EditorDialog from "./editor-dialog";
import RequirementCsvImport from "./requirement-csv-import";
import GitHubAssigneeSelect from "./github-assignee-select";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  requirementStates,
  requirementLabel,
  type Requirement,
  type IssuePublication,
} from "../core/requirement-model";
import type { Stored, Project, Feature, Task } from "../core/model";
import MarkdownBody from "./markdown-body";
import type { KnowledgeEntry } from "../core/knowledge-model";
import ReferencePicker from "./reference-picker";
import RequirementTasksDialog from "./requirement-tasks-dialog";
import { requirementTaskIds } from "../core/requirement-model";

export { default as EditorDialog } from "./editor-dialog";
export default function RequirementsPanel({
  rows,
  publications,
  projects,
  features,
  tasks,
  project,
  canWrite,
  api,
  onRefresh,
  onOpenTask,
  knowledge,
  onManageProject,
  requestedId,
  onRequestedOpen,
}: {
  rows: Stored<Requirement>[];
  publications: Stored<IssuePublication>[];
  projects: Stored<Project>[];
  features: Stored<Feature>[];
  tasks: Stored<Task>[];
  project: string;
  canWrite: boolean;
  api: (path: string, body?: unknown) => Promise<any>;
  onRefresh: () => Promise<void>;
  onOpenTask: (task: Stored<Task>) => void;
  knowledge: Stored<KnowledgeEntry>[];
  onManageProject: (id: string) => void;
  requestedId?: string;
  onRequestedOpen?: () => void;
}) {
  const [showAllColumns, setShowAllColumns] = useState(false);
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<
      Stored<Requirement> | null | undefined
    >(undefined),
    [formProject, setFormProject] = useState("");
  const [mode, setMode] = useState<"convert" | "delete" | "issue" | null>(null),
    [feature, setFeature] = useState(""),
    [issueRow, setIssueRow] = useState<Stored<Requirement> | null>(null),
    [repository, setRepository] = useState("");
  const [issueAssignee, setIssueAssignee] = useState(""),
    [issueAssigneeValid, setIssueAssigneeValid] = useState(false);
  const [managingId, setManagingId] = useState<string | null>(null);
  const [issueTaskId, setIssueTaskId] = useState("");
  const label = (row: Requirement) =>
    requirementLabel(
      row,
      projects.find((project) => project.data.id === row.project)?.data
        .featurePrefix,
    );
  const [preview, setPreview] = useState<{
      title: string;
      body: string;
      repository: string;
      previewHash: string;
      assignee: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const submitting = useRef(false);
  useEffect(() => {
    if (!requestedId) return;
    const row = rows.find((r) => r.data.id === requestedId);
    if (row) {
      setFormProject(row.data.project);
      setEditing(row);
      setError("");
    }
    onRequestedOpen?.();
  }, [requestedId, rows, onRequestedOpen]);
  const currentIssueRow =
    rows.find((row) => row.data.id === issueRow?.data.id) ?? issueRow;
  const issueTasks = currentIssueRow
    ? tasks.filter((t) =>
        requirementTaskIds(currentIssueRow.data).includes(t.data.id),
      )
    : [];
  const issueTask =
    issueTasks.find((task) => task.data.id === issueTaskId) ??
    (issueTasks.length === 1 ? issueTasks[0] : undefined);
  const issuePublication = publications.find(
    (p) =>
      p.data.requirement === currentIssueRow?.data.id &&
      p.data.task === issueTask?.data.id,
  )?.data;
  const managingRow = rows.find((r) => r.data.id === managingId);
  const issueProject = projects.find(
    (row) => row.data.id === currentIssueRow?.data.project,
  );
  const visible = rows
    .filter(
      (r) =>
        (!project || r.data.project === project) &&
        (!status || r.data.status === status) &&
        (!query ||
          `${label(r.data)} ${r.data.sourceId ?? ""} ${r.data.featureName} ${r.data.description} ${r.data.assignee}`
            .toLowerCase()
            .includes(query.toLowerCase())),
    )
    .sort(
      (a, b) =>
        a.data.project.localeCompare(b.data.project) ||
        a.data.number - b.data.number,
    );
  const checked = visible.filter((r) => selected.includes(r.data.id));
  const selectedProject = checked[0]?.data.project ?? "";
  const sameProject =
    checked.length > 0 &&
    checked.every((r) => r.data.project === selectedProject);
  const entries = () =>
    checked.map((r) => ({ id: r.data.id, revision: r.revision }));
  async function run(work: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리하지 못했습니다.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draftForm = event.currentTarget;
    const form = new FormData(draftForm);
    await run(async () => {
      await api("requirements", {
        revision: editing?.revision,
        data: {
          id: editing?.data.id ?? createId(),
          project: formProject,
          featureName: String(form.get("featureName")),
          description: String(form.get("description")),
          policy: String(form.get("policy")),
          policyIds: form.getAll("policyIds").map(String),
          glossaryIds: form.getAll("glossaryIds").map(String),
          remarks: String(form.get("remarks")),
          status: String(form.get("status")),
          assignee: String(form.get("assignee")),
        },
      });
      draftSaved(draftForm);
      setEditing(undefined);
      setNotice("PRD 항목을 저장했습니다.");
    });
  }
  function close() {
    setEditing(undefined);
    setMode(null);
    setPreview(null);
    setError("");
  }
  function openIssue(row: Stored<Requirement>, preferredTask?: Stored<Task>) {
    const linked = tasks.filter((t) =>
      requirementTaskIds(row.data).includes(t.data.id),
    );
    const task =
      preferredTask ??
      linked.find(
        (t) =>
          !publications.some(
            (p) =>
              p.data.requirement === row.data.id &&
              p.data.task === t.data.id &&
              p.data.state !== "failed",
          ),
      ) ??
      linked[0];
    setIssueRow(row);
    setIssueTaskId(task?.data.id ?? "");
    setIssueAssignee(task?.data.assignee ?? row.data.assignee);
    setIssueAssigneeValid(!(task?.data.assignee ?? row.data.assignee));
    setRepository(
      task?.data.repository ??
        projects.find((p) => p.data.id === row.data.project)?.data
          .repositories[0] ??
        "",
    );
    setPreview(null);
    setError("");
    setManagingId(null);
    setMode("issue");
  }
  return (
    <section className="prd-panel" aria-label="PRD 관리">
      <div className="section-title">
        <div>
          <h2>PRD 요구사항</h2>
          <p className="muted">
            기획을 표로 정리하고 선택한 항목을 개발 태스크로 전환하세요.
          </p>
        </div>
        <div className="actions prd-create-actions">
          <RequirementCsvImport
            projects={projects}
            preferredProject={project}
            canWrite={canWrite && !busy}
            api={api}
            onRefresh={onRefresh}
          />
          <button
            className="button"
            disabled={!canWrite || busy || !projects.length}
            onClick={() => {
              setFormProject(project || projects[0]?.data.id || "");
              setEditing(null);
              setError("");
            }}
          >
            ＋ PRD 작성
          </button>
        </div>
      </div>
      {!projects.length && (
        <div className="empty">프로젝트를 먼저 만든 뒤 PRD를 작성하세요.</div>
      )}
      <div className="prd-toolbar">
        <div className="view-switch" role="group" aria-label="PRD 보기 방식">
          <button
            aria-pressed={!showAllColumns}
            onClick={() => setShowAllColumns(false)}
          >
            간단 보기
          </button>
          <button
            aria-pressed={showAllColumns}
            onClick={() => setShowAllColumns(true)}
          >
            전체 열 보기
          </button>
        </div>
        <input
          aria-label="PRD 검색"
          placeholder="번호·기능명·설명·담당자 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="PRD 상태 필터"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">모든 PRD 상태</option>
          {Object.entries(requirementStates).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <span className="muted">
          {visible.length}개 · 선택 {checked.length}개
        </span>
      </div>
      <div className="prd-toolbar prd-bulk-actions" hidden={!checked.length}>
        <button
          className="button secondary"
          disabled={!canWrite || busy || !sameProject}
          onClick={() => {
            setMode("convert");
            setFeature("");
            setError("");
          }}
        >
          선택 항목 → 태스크
        </button>
        <button
          className="button secondary danger"
          disabled={!canWrite || busy || !checked.length}
          onClick={() => {
            setMode("delete");
            setError("");
          }}
        >
          선택 삭제
        </button>
        <small className="muted">
          같은 프로젝트의 항목을 최대 100개까지 함께 전환할 수 있습니다.
        </small>
      </div>
      {notice && (
        <div className="demo-banner" role="status">
          {notice}
        </div>
      )}
      {error && editing === undefined && !mode && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <div
        className="prd-table-scroll"
        role="region"
        aria-label="PRD 요구사항 표"
        tabIndex={0}
      >
        <table
          className={`prd-table ${showAllColumns ? "prd-full" : "prd-compact"}`}
        >
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="보이는 PRD 전체 선택"
                  checked={
                    visible.length > 0 &&
                    visible.every((r) => selected.includes(r.data.id))
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? visible.map((r) => r.data.id) : [],
                    )
                  }
                />
              </th>
              {[
                "넘버링",
                "기능명",
                "상세설명",
                "정책",
                "비고",
                "상태",
                "최종 편집일시",
                "편집자",
                "담당자",
                "연결 및 관리",
              ].map((label) => (
                <th
                  key={label}
                  className={
                    [
                      "상세설명",
                      "정책",
                      "비고",
                      "최종 편집일시",
                      "편집자",
                    ].includes(label)
                      ? "prd-extra"
                      : undefined
                  }
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const r = row.data,
                linkedTasks = tasks.filter((t) =>
                  requirementTaskIds(r).includes(t.data.id),
                ),
                issued = publications.filter(
                  (p) =>
                    p.data.requirement === r.id && p.data.state === "created",
                );
              return (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${label(r)} 선택`}
                      checked={selected.includes(r.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, r.id]
                            : selected.filter((id) => id !== r.id),
                        )
                      }
                    />
                  </td>
                  <td className="prd-number">
                    <strong>{label(r)}</strong>
                    {r.sourceId && <small>원본 ID: {r.sourceId}</small>}
                    <small>
                      {projects.find((p) => p.data.id === r.project)?.data.name}
                    </small>
                  </td>
                  <td className="prd-name">
                    <button
                      className="text-button"
                      onClick={() => {
                        setFormProject(r.project);
                        setEditing(row);
                        setError("");
                      }}
                    >
                      {r.featureName}
                    </button>
                  </td>
                  {(["description", "policy", "remarks"] as const).map(
                    (key) => (
                      <td key={key} className="prd-extra">
                        {r[key] ? (
                          <details>
                            <summary>
                              {r[key].slice(0, 70)}
                              {r[key].length > 70 ? "…" : ""}
                            </summary>
                            <MarkdownBody
                              body={r[key]}
                              repository={
                                projects.find((p) => p.data.id === r.project)
                                  ?.data.repositories[0] ?? ""
                              }
                            />
                          </details>
                        ) : (
                          <span className="muted">—</span>
                        )}
                        {key === "policy" &&
                          (r.policyIds ?? []).map((documentId) => {
                            const doc = knowledge.find(
                              (d) => d.data.id === documentId,
                            );
                            return doc ? (
                              <details key={documentId}>
                                <summary>참조: {doc.data.name}</summary>
                                <MarkdownBody
                                  body={doc.data.content}
                                  repository=""
                                />
                              </details>
                            ) : null;
                          })}
                      </td>
                    ),
                  )}
                  <td className="prd-status">
                    <span className={`tag prd-state-${r.status}`}>
                      {requirementStates[r.status]}
                    </span>
                  </td>
                  <td className="prd-extra">
                    <time dateTime={row.updatedAt}>
                      {new Date(row.updatedAt).toLocaleString("ko-KR")}
                    </time>
                    {r.source?.editedAt && (
                      <small>
                        원본:{" "}
                        {new Date(r.source.editedAt).toLocaleString("ko-KR")}
                      </small>
                    )}
                  </td>
                  <td className="prd-extra">
                    {r.editor}
                    {r.source?.editor && <small>원본: {r.source.editor}</small>}
                  </td>
                  <td className="prd-assignee">
                    <span className="prd-mobile-label">담당자 </span>
                    {r.assignee || "미지정"}
                  </td>
                  <td className="prd-connections">
                    <div className="prd-row-actions">
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => setManagingId(r.id)}
                      >
                        {linkedTasks.length
                          ? `태스크 관리 · ${linkedTasks.length}개`
                          : "＋ 개발 태스크 추가"}
                      </button>
                      {linkedTasks.length === 1 && (
                        <button
                          className="text-button"
                          onClick={() => onOpenTask(linkedTasks[0]!)}
                        >
                          태스크 열기
                        </button>
                      )}
                      {!linkedTasks.length && (
                        <small className="muted">태스크 미전환</small>
                      )}
                      {!!linkedTasks.length && (
                        <small>
                          완료{" "}
                          {
                            linkedTasks.filter((t) => t.data.status === "done")
                              .length
                          }
                          /{linkedTasks.length}
                        </small>
                      )}
                      {issued.map(({ data: p }) => (
                        <a
                          key={p.id}
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {p.repository} #{p.number} ↗
                        </a>
                      ))}
                      <button
                        className="text-button"
                        disabled={!canWrite || busy}
                        onClick={() => openIssue(row)}
                      >
                        GitHub 이슈 생성
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!visible.length && projects.length > 0 && (
        <div className="empty empty-state">
          {query || status ? (
            <>
              <strong>검색 조건에 맞는 PRD가 없습니다.</strong>
              <button
                onClick={() => {
                  setQuery("");
                  setStatus("");
                }}
              >
                PRD 검색 초기화
              </button>
            </>
          ) : (
            "아직 PRD 항목이 없습니다. ‘PRD 작성’으로 기획을 등록하세요."
          )}
        </div>
      )}
      <p className="muted prd-footnote">
        넘버링은 프로젝트의 5자리 기능 식별자와 자동 순번으로 부여됩니다.
        편집일시·편집자는 자동 기록되며, PRD 상태는 태스크 완료 상태와 별도로
        관리합니다. PRD 수정은 이미 생성된 태스크·이슈를 덮어쓰지 않습니다.
      </p>
      {editing !== undefined && (
        <EditorDialog
          draftKey={`requirement:${editing?.data.id ?? "new"}`}
          revision={editing?.revision}
          onDraftRestore={(values) => {
            if (values["@PRD 프로젝트"]?.[0])
              setFormProject(values["@PRD 프로젝트"][0]);
          }}
          title={editing ? "PRD 항목 편집" : "PRD 작성"}
          busy={busy}
          onClose={close}
        >
          <form onSubmit={save}>
            <fieldset disabled={busy || !canWrite} className="prd-fields">
              <label>
                프로젝트
                <select
                  aria-label="PRD 프로젝트"
                  value={formProject}
                  disabled={!!editing}
                  onChange={(e) => setFormProject(e.target.value)}
                  required
                >
                  {projects.map((p) => (
                    <option key={p.data.id} value={p.data.id}>
                      {p.data.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                기능명
                <input
                  name="featureName"
                  required
                  maxLength={200}
                  defaultValue={editing?.data.featureName}
                  autoFocus
                />
              </label>
              <label>
                상세설명
                <textarea
                  name="description"
                  aria-label="상세설명"
                  rows={5}
                  maxLength={4000}
                  defaultValue={editing?.data.description}
                  placeholder="사용자 관점의 동작과 수용 기준을 작성하세요. Markdown 지원"
                />
              </label>
              <label>
                정책
                <textarea
                  name="policy"
                  aria-label="정책"
                  rows={4}
                  maxLength={2000}
                  defaultValue={editing?.data.policy}
                  placeholder="권한, 예외, 입력 제한 등"
                />
              </label>
              <label>
                비고
                <textarea
                  name="remarks"
                  aria-label="비고"
                  rows={3}
                  maxLength={1000}
                  defaultValue={editing?.data.remarks}
                />
              </label>
              <ReferencePicker
                key={`policy-${editing?.data.id ?? "new"}`}
                name="policyIds"
                label="관련 정책"
                buttonLabel="정책 선택"
                initial={editing?.data.policyIds}
                options={knowledge
                  .filter((r) => r.data.kind === "policy")
                  .map((r) => r.data)}
              />
              <ReferencePicker
                key={`glossary-${editing?.data.id ?? "new"}`}
                name="glossaryIds"
                label="관련 용어"
                buttonLabel="용어 선택"
                initial={editing?.data.glossaryIds}
                options={knowledge
                  .filter((r) => r.data.kind === "glossary")
                  .map((r) => r.data)}
              />
              <div className="form-grid">
                <label>
                  상태
                  <select
                    name="status"
                    aria-label="상태"
                    defaultValue={editing?.data.status ?? "draft"}
                  >
                    {Object.entries(requirementStates).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <GitHubAssigneeSelect
                  key={`prd-assignee-${editing?.data.id ?? "new"}-${formProject}`}
                  api={api}
                  project={formProject}
                  defaultValue={editing?.data.assignee}
                />
              </div>
            </fieldset>
            <p className="muted">
              {editing
                ? label(editing.data)
                : `${projects.find((project) => project.data.id === formProject)?.data.featurePrefix ?? "5자리 식별자"}-순번 자동 부여`}{" "}
              · 최종 편집일시와 편집자는 저장 시 자동 기록됩니다.
            </p>
            {error && (
              <p role="alert" className="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                data-draft-close
                onClick={close}
              >
                닫기
              </button>
              {canWrite && (
                <button className="button" disabled={busy || !formProject}>
                  {busy ? "저장 중…" : "PRD 저장"}
                </button>
              )}
            </div>
          </form>
        </EditorDialog>
      )}
      {mode === "convert" && (
        <EditorDialog title="PRD를 태스크로 전환" busy={busy} onClose={close}>
          <p>
            선택한 {checked.length}개 항목의 상세설명·정책·비고·담당자를
            태스크에 복사합니다. 이미 전환된 항목은 중복 생성하지 않습니다.
          </p>
          <p>
            각 PRD에 기본 태스크 하나를 만듭니다. 추가 작업은 ‘태스크 관리’에서
            담당자·저장소별로 나눌 수 있습니다.
          </p>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={close}
            >
              취소
            </button>
            <button
              className="button"
              disabled={busy || !canWrite || checked.length > 100}
              onClick={() =>
                void run(async () => {
                  const result = await api("requirements/convert", {
                    entries: entries(),
                    feature: null,
                  });
                  setMode(null);
                  setSelected([]);
                  setNotice(
                    `${result.results.filter((r: { created: boolean }) => r.created).length}개 태스크를 생성했습니다.`,
                  );
                })
              }
            >
              태스크 생성
            </button>
          </div>
        </EditorDialog>
      )}
      {mode === "delete" && (
        <EditorDialog title="PRD 삭제 확인" busy={busy} onClose={close}>
          <p>
            선택한 {checked.length}개 PRD 항목을 삭제합니다. 태스크로
            전환되었거나 이슈 발행 이력이 있는 항목은 삭제할 수 없으며 보류
            상태로 관리할 수 있습니다.
          </p>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={close}
            >
              취소
            </button>
            <button
              className="button danger"
              disabled={busy || !canWrite || checked.length > 100}
              onClick={() =>
                void run(async () => {
                  await api("requirements/delete", { entries: entries() });
                  setMode(null);
                  setSelected([]);
                  setNotice("선택한 PRD를 삭제했습니다.");
                })
              }
            >
              삭제 확인
            </button>
          </div>
        </EditorDialog>
      )}
      {mode === "issue" && currentIssueRow && (
        <EditorDialog title="GitHub 이슈 생성" busy={busy} onClose={close}>
          <p>
            선택한 태스크의 저장소에 실제 이슈를 생성합니다. 이슈는 해당
            태스크에 연결되며 PRD에서도 모아 볼 수 있습니다. 연결된 GitHub
            토큰에 해당 저장소의 Issues 쓰기 권한이 필요합니다.
          </p>
          {!issueTasks.length && (
            <div className="demo-banner">
              <strong>먼저 PRD를 태스크로 전환해 주세요.</strong>
              <p>
                아래 ‘태스크로 전환하고 계속’을 누르면 연결된 태스크를 만든 뒤
                이슈 본문을 확인할 수 있습니다. 이 단계에서는 GitHub에 이슈를
                만들지 않습니다.
              </p>
            </div>
          )}
          {!!issueTasks.length && (
            <label>
              대상 태스크
              <select
                aria-label="이슈 대상 태스크"
                disabled={busy}
                value={issueTask?.data.id ?? ""}
                onChange={(e) => {
                  const task = issueTasks.find(
                    (t) => t.data.id === e.target.value,
                  );
                  setIssueTaskId(e.target.value);
                  setIssueAssignee(task?.data.assignee ?? "");
                  setIssueAssigneeValid(!task?.data.assignee);
                  setRepository(
                    task?.data.repository ??
                      issueProject?.data.repositories[0] ??
                      "",
                  );
                  setPreview(null);
                  setError("");
                }}
              >
                <option value="" disabled>
                  태스크를 선택하세요
                </option>
                {issueTasks.map((t) => (
                  <option key={t.data.id} value={t.data.id}>
                    {t.data.title}
                    {t.data.repository ? ` · ${t.data.repository}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {issuePublication?.state === "created" && (
            <p className="notice">
              이미 발행한 이슈입니다.{" "}
              <a href={issuePublication.url} target="_blank" rel="noreferrer">
                {issuePublication.repository} #{issuePublication.number} ↗
              </a>
            </p>
          )}
          {issuePublication &&
            ["unknown", "publishing"].includes(issuePublication.state) && (
              <p className="alert">
                이 태스크의 이슈 생성 결과를 GitHub 원본에서 확인해야 합니다.
                중복 발행을 막기 위해 다시 생성할 수 없습니다.
              </p>
            )}
          {!issueProject?.data.repositories.length && (
            <div className="alert" role="status">
              <strong>프로젝트에 연결된 GitHub 저장소가 없습니다.</strong>
              <p>
                태스크로 전환한 뒤 프로젝트에 저장소를 연결하면 이슈를 생성할 수
                있습니다.
              </p>
              <button
                className="button secondary"
                disabled={busy || !canWrite}
                onClick={() => {
                  const id = currentIssueRow.data.project;
                  close();
                  onManageProject(id);
                }}
              >
                프로젝트 저장소 설정
              </button>
            </div>
          )}
          <label>
            대상 저장소
            <select
              aria-label="이슈 대상 저장소"
              value={repository}
              disabled={busy || !!issueTask?.data.repository}
              onChange={(e) => {
                setRepository(e.target.value);
                setPreview(null);
              }}
            >
              {!issueProject?.data.repositories.length && (
                <option value="">연결된 저장소 없음</option>
              )}
              {issueProject?.data.repositories.map((repo) => (
                <option key={repo}>{repo}</option>
              ))}
            </select>
          </label>
          <GitHubAssigneeSelect
            key={`issue-assignee-${currentIssueRow.data.id}-${issueTask?.data.id}-${repository}`}
            api={api}
            project={currentIssueRow.data.project}
            repository={repository || undefined}
            value={issueAssignee}
            label="GitHub 이슈 담당자"
            onChange={(login) => {
              setIssueAssignee(login);
              setPreview(null);
            }}
            onValidityChange={setIssueAssigneeValid}
          />
          <small>
            태스크 담당자를 기본 선택합니다. 여기서 바꾸면 이번에 생성하는
            GitHub 이슈에 적용됩니다.
          </small>
          {preview && (
            <article className="prd-issue-preview">
              <h3>{preview.title}</h3>
              <MarkdownBody
                body={preview.body}
                repository={preview.repository}
              />
            </article>
          )}
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={close}
            >
              취소
            </button>
            {!issueTasks.length ? (
              <button
                className="button"
                disabled={busy || !canWrite}
                onClick={() =>
                  void run(async () => {
                    await api("requirements/convert", {
                      entries: [
                        {
                          id: currentIssueRow.data.id,
                          revision: currentIssueRow.revision,
                        },
                      ],
                      feature: null,
                    });
                    setPreview(null);
                    setNotice(
                      "태스크로 전환했습니다. 대상 저장소와 이슈 본문을 확인해 주세요.",
                    );
                  })
                }
              >
                {busy ? "태스크 전환 중…" : "태스크로 전환하고 계속"}
              </button>
            ) : issuePublication &&
              issuePublication.state !== "failed" ? null : !preview ? (
              <button
                className="button"
                disabled={
                  busy || !issueTask || !repository || !issueAssigneeValid
                }
                onClick={() =>
                  void run(async () =>
                    setPreview(
                      await api("requirements/issue-preview", {
                        id: currentIssueRow.data.id,
                        revision: currentIssueRow.revision,
                        taskId: issueTask?.data.id,
                        repository,
                        assignee: issueAssignee,
                      }),
                    ),
                  )
                }
              >
                본문 미리보기
              </button>
            ) : (
              <button
                className="button"
                disabled={busy || !canWrite || !issueAssigneeValid}
                onClick={() =>
                  void run(async () => {
                    const result = await api("requirements/issue", {
                      id: currentIssueRow.data.id,
                      revision: currentIssueRow.revision,
                      taskId: issueTask?.data.id,
                      repository,
                      assignee: issueAssignee,
                      previewHash: preview.previewHash,
                    });
                    setMode(null);
                    setNotice(
                      result.assignmentWarning ??
                        "GitHub 이슈를 생성하고 태스크에 연결했습니다.",
                    );
                  })
                }
              >
                GitHub에 이슈 생성
              </button>
            )}
          </div>
        </EditorDialog>
      )}
      {managingRow && (
        <RequirementTasksDialog
          key={managingRow.data.id}
          row={managingRow}
          project={
            projects.find((p) => p.data.id === managingRow.data.project)?.data
          }
          tasks={tasks}
          publications={publications}
          canWrite={canWrite}
          api={api}
          onRefresh={onRefresh}
          onClose={() => setManagingId(null)}
          onOpenTask={(task) => {
            setManagingId(null);
            onOpenTask(task);
          }}
          onIssue={(task) => openIssue(managingRow, task)}
        />
      )}
    </section>
  );
}
