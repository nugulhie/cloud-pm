"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import EditorDialog from "./editor-dialog";
import type { Service } from "../core/service";
import {
  ASANA_MAX_FILE_BYTES,
  ASANA_PREVIEW_PAGE_SIZE,
} from "../core/asana-limits";
type Preview = Awaited<ReturnType<Service["previewAsanaProject"]>>;
export default function AsanaFileImport({
  canWrite,
  api,
  onRefresh,
  onImported,
}: {
  canWrite: boolean;
  api: (path: string, body?: unknown) => Promise<any>;
  onRefresh: () => Promise<void>;
  onImported: (project: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [projectName, setProjectName] = useState(""),
    [sourceProjectKey, setSourceProjectKey] = useState(""),
    [file, setFile] = useState<{
      fileName: string;
      format: "csv" | "json";
      content: string;
    } | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [mode, setMode] = useState<"skip" | "update">("skip"),
    [parentPolicy, setParentPolicy] = useState<"error" | "keep_unlinked">(
      "error",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [preview]);
  const pending = useRef(false);
  async function run(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function prepare(policy = parentPolicy) {
    if (!file) return;
    const value = await api("projects/import/asana/preview", {
      ...file,
      unresolvedParents: policy,
      ...(projectName.trim() ? { projectName: projectName.trim() } : {}),
      ...(sourceProjectKey.trim()
        ? { sourceProjectKey: sourceProjectKey.trim() }
        : {}),
    });
    setProjectName(value.projectInfo.data.name);
    setSourceProjectKey(value.projectInfo.sourceKey);
    setPreview(value);
    setSelected(
      value.rows
        .filter((row: Preview["rows"][number]) => !row.errors.length)
        .map((row: Preview["rows"][number]) => row.sourceId),
    );
  }
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const rowsById = useMemo(
    () => new Map(preview?.rows.map((row) => [row.sourceId, row]) ?? []),
    [preview],
  );
  const rows =
    preview?.rows.filter((row) => selectedIds.has(row.sourceId)) ?? [];
  const missingParent = rows.some(
    (row) =>
      row.parentSourceId &&
      !selectedIds.has(row.parentSourceId) &&
      rowsById.has(row.parentSourceId) &&
      !rowsById.get(row.parentSourceId)!.existing,
  );
  const pageCount = Math.max(
    1,
    Math.ceil((preview?.rows.length ?? 0) / ASANA_PREVIEW_PAGE_SIZE),
  );
  const visibleRows =
    preview?.rows.slice(
      (page - 1) * ASANA_PREVIEW_PAGE_SIZE,
      page * ASANA_PREVIEW_PAGE_SIZE,
    ) ?? [];
  const displayedProject =
    mode === "skip" && preview?.projectInfo.currentData
      ? preview.projectInfo.currentData
      : preview?.projectInfo.data;
  return (
    <>
      <button
        className="button secondary"
        disabled={!canWrite}
        onClick={() => {
          setProjectName("");
          setSourceProjectKey("");
          setParentPolicy("error");
          setOpen(true);
          setFile(null);
          setPreview(null);
          setSelected([]);
          setError("");
          setNotice("");
        }}
      >
        외부 프로젝트 가져오기
      </button>
      {open && (
        <EditorDialog
          title="Asana 프로젝트 가져오기"
          busy={busy}
          onClose={() => setOpen(false)}
        >
          <p>
            Asana 프로젝트를 CSV·JSON으로 가져오면 프로젝트와 그 아래 작업을
            함께 만듭니다. GitHub 저장소는 나중에 연결할 수 있습니다. 파일당 10
            MiB·10,000개 작업을 지원합니다.
          </p>
          <div className="prd-fields">
            <label>
              CSV 또는 JSON 파일
              <input
                aria-label="Asana 파일"
                type="file"
                accept=".csv,.json,text/csv,application/json"
                disabled={busy}
                onChange={(event) => {
                  const upload = event.target.files?.[0];
                  setFile(null);
                  setProjectName("");
                  setSourceProjectKey("");
                  setParentPolicy("error");
                  setPreview(null);
                  setSelected([]);
                  setError("");
                  setNotice("");
                  if (!upload) return;
                  void run(async () => {
                    const extension = upload.name
                      .split(".")
                      .at(-1)
                      ?.toLowerCase();
                    if (extension !== "csv" && extension !== "json")
                      throw new Error("CSV 또는 JSON 파일을 선택하세요.");
                    if (upload.size > ASANA_MAX_FILE_BYTES)
                      throw new Error("파일은 10 MiB 이하로 올려주세요.");
                    let content: string;
                    try {
                      content = new TextDecoder("utf-8", {
                        fatal: true,
                      }).decode(await upload.arrayBuffer());
                    } catch {
                      throw new Error(
                        "UTF-8 파일로 저장한 뒤 다시 선택하세요.",
                      );
                    }
                    setFile({
                      fileName: upload.name,
                      format: extension,
                      content,
                    });
                  });
                }}
              />
            </label>
            <label>
              상위 작업을 구분할 수 없을 때
              <select
                aria-label="상위 작업 미확인 처리"
                value={parentPolicy}
                disabled={busy}
                onChange={(event) => {
                  setParentPolicy(event.target.value as typeof parentPolicy);
                  setPreview(null);
                }}
              >
                <option value="error">오류로 표시하고 가져오기에서 제외</option>
                <option value="keep_unlinked">
                  원문 보존 · 신규는 미연결, 기존 상위 연결 유지
                </option>
              </select>
            </label>
            <label>
              가져올 프로젝트 이름
              <input
                aria-label="가져올 프로젝트 이름"
                placeholder="미리보기에서 자동으로 채워집니다. 직접 입력할 수도 있습니다."
                maxLength={200}
                disabled={busy}
                value={projectName}
                onChange={(event) => {
                  setProjectName(event.target.value);
                  setPreview(null);
                }}
              />
            </label>
            <details>
              <summary>원본 프로젝트 식별 설정</summary>
              <label>
                원본 프로젝트 키
                <input
                  aria-label="Asana 원본 프로젝트 키"
                  maxLength={300}
                  disabled={busy}
                  value={sourceProjectKey}
                  placeholder="파일의 프로젝트 ID 또는 이름으로 자동 판단"
                  onChange={(event) => {
                    setSourceProjectKey(event.target.value);
                    setPreview(null);
                  }}
                />
              </label>
              <small>
                다른 프로젝트가 이름이 같거나 원본 이름을 바꿨다면 기존 키를
                지정하세요.
              </small>
            </details>
            <label>
              중복 처리
              <select
                aria-label="Asana 중복 처리"
                disabled={busy}
                value={mode}
                onChange={(event) => setMode(event.target.value as typeof mode)}
              >
                <option value="skip">기존 작업 유지하고 건너뛰기</option>
                <option value="update">
                  파일에 있는 필드로 기존 작업 갱신
                </option>
              </select>
            </label>
            {mode === "update" && (
              <p className="muted">
                파일의 프로젝트 이름·목표·일정과 작업의
                제목·설명·담당자·기한·우선순위·상위 관계를 반영합니다. 현재 진행
                상태·완료 조건·댓글·GitHub 연결은 유지됩니다.
              </p>
            )}
            <button
              disabled={busy || !file}
              onClick={() => void run(() => prepare())}
            >
              {busy ? "처리 중…" : "파일 미리보기"}
            </button>
          </div>
          {preview && (
            <div className="asana-preview">
              <div className="external-project-preview">
                <strong>
                  {preview.projectInfo.existing
                    ? "기존 외부 프로젝트에 반영"
                    : "새 프로젝트 생성"}
                  : {displayedProject?.name}
                </strong>
                <small>원본 키: {preview.projectInfo.sourceKey}</small>
                <small>
                  {displayedProject?.startDate || "시작일 미지정"} ~{" "}
                  {displayedProject?.endDate || "종료일 미지정"}
                </small>
                {displayedProject?.goal && <p>{displayedProject?.goal}</p>}
              </div>
              <p>
                {preview.counts.total}개 · 기존 {preview.counts.existing}개 ·
                오류 {preview.counts.invalid}개 · 선택 {selected.length}개
              </p>
              {preview.warnings.map((warning) => (
                <p className="muted" key={warning}>
                  {warning}
                </p>
              ))}
              {!!preview.counts.unresolvedParents &&
                parentPolicy === "error" && (
                  <div className="external-project-preview">
                    <p>
                      상위를 구분할 수 없는 작업이{" "}
                      {preview.counts.unresolvedParents}개 있습니다. 원본을
                      보존하고 상위 연결 없이 가져올 수 있습니다. 기존 작업의
                      상위 연결은 유지합니다.
                    </p>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => {
                        setParentPolicy("keep_unlinked");
                        setPreview(null);
                        void run(() => prepare("keep_unlinked"));
                      }}
                    >
                      상위 작업을 연결하지 않고 다시 확인
                    </button>
                  </div>
                )}
              <div className="bulk-toolbar">
                <button
                  disabled={busy}
                  onClick={() =>
                    setSelected(
                      preview.rows
                        .filter((row) => !row.errors.length)
                        .map((row) => row.sourceId),
                    )
                  }
                >
                  정상 항목 전체 선택
                </button>
                <button disabled={busy} onClick={() => setSelected([])}>
                  선택 해제
                </button>
              </div>
              <p className="muted">
                전체 선택은 모든 페이지에 적용됩니다.{" "}
                {selected.length.toLocaleString()}개 선택됨
              </p>
              <nav className="bulk-toolbar" aria-label="Asana 미리보기 페이지">
                <button
                  disabled={busy || page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  이전 페이지
                </button>
                <span aria-live="polite">
                  {page} / {pageCount} 페이지
                </span>
                <button
                  disabled={busy || page >= pageCount}
                  onClick={() => setPage(page + 1)}
                >
                  다음 페이지
                </button>
              </nav>
              <div
                className="asana-preview-scroll"
                role="region"
                aria-label="Asana 가져오기 미리보기"
                tabIndex={0}
              >
                <table className="asana-preview-table">
                  <thead>
                    <tr>
                      <th>선택</th>
                      <th>작업명·원본 ID</th>
                      <th>담당자·기한</th>
                      <th>원본·처리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr key={row.row}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`가져오기: ${row.title}`}
                            disabled={busy || !!row.errors.length}
                            checked={selectedIds.has(row.sourceId)}
                            onChange={(event) =>
                              setSelected(
                                event.target.checked
                                  ? [...selected, row.sourceId]
                                  : selected.filter(
                                      (id) => id !== row.sourceId,
                                    ),
                              )
                            }
                          />
                        </td>
                        <td>
                          <strong>{row.title || "이름 없음"}</strong>
                          <small>{row.sourceId}</small>
                          {row.parentRef && (
                            <small>상위: {row.parentRef}</small>
                          )}
                          {row.errors.map((value) => (
                            <small className="import-row-error" key={value}>
                              {value}
                            </small>
                          ))}
                          {row.warnings.map((value) => (
                            <small className="muted" key={value}>
                              {value}
                            </small>
                          ))}
                        </td>
                        <td>
                          {row.assignee || "미지정"}
                          <small>{row.dueDate || "기한 없음"}</small>
                        </td>
                        <td>
                          {row.completed ? "Asana 완료" : "Asana 미완료"}
                          <small>
                            {row.existing
                              ? mode === "skip"
                                ? "기존 유지"
                                : "갱신"
                              : "새 작업 · 대기"}
                          </small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {missingParent && (
            <p className="alert" role="alert">
              하위 작업의 상위 작업도 함께 선택하세요.
            </p>
          )}
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="success-note" role="status">
              {notice}
            </p>
          )}
          <div className="form-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              닫기
            </button>
            <button
              className="button"
              disabled={busy || !preview || !file || missingParent}
              onClick={() =>
                void run(async () => {
                  const result = await api("projects/import/asana", {
                    ...file,
                    unresolvedParents: parentPolicy,
                    ...(projectName.trim()
                      ? { projectName: projectName.trim() }
                      : {}),
                    ...(sourceProjectKey.trim()
                      ? { sourceProjectKey: sourceProjectKey.trim() }
                      : {}),
                    mode,
                    previewHash: preview!.previewHash,
                    ids: selected,
                  });
                  setPreview(null);
                  setSelected([]);
                  await onRefresh();
                  onImported(result.project);
                  setNotice(
                    `${result.projectCreated ? "프로젝트를 만들었습니다. " : "기존 프로젝트에 반영했습니다. "}작업 ${result.created}개 추가, ${result.updated}개 갱신, ${result.skipped}개 건너뛰었습니다.`,
                  );
                })
              }
            >
              {busy
                ? "가져오는 중…"
                : `프로젝트와 선택 작업 ${selected.length}개 가져오기`}
            </button>
          </div>
        </EditorDialog>
      )}
    </>
  );
}
