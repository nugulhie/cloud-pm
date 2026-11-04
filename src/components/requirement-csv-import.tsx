"use client";
import { useRef, useState } from "react";
import EditorDialog from "./editor-dialog";
import { requirementStates } from "../core/requirement-model";
import type { Project, Stored } from "../core/model";
import type { Service } from "../core/service";
type Preview = Awaited<ReturnType<Service["previewRequirementCsv"]>>;
export default function RequirementCsvImport({
  projects,
  preferredProject,
  canWrite,
  api,
  onRefresh,
}: {
  projects: Stored<Project>[];
  preferredProject: string;
  canWrite: boolean;
  api: (path: string, body?: unknown) => Promise<any>;
  onRefresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [project, setProject] = useState(""),
    [fileName, setFileName] = useState(""),
    [csv, setCsv] = useState(""),
    [mode, setMode] = useState<"skip" | "update">("skip"),
    [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const pending = useRef(false);
  async function run(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "파일을 처리하지 못했습니다.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const text = (value: string) =>
    value ? (
      <details>
        <summary>
          {value.slice(0, 60)}
          {value.length > 60 ? "…" : ""}
        </summary>
        <div className="csv-preview-text">{value}</div>
      </details>
    ) : (
      "—"
    );
  return (
    <>
      <button
        className="button secondary"
        disabled={!canWrite || !projects.length}
        onClick={() => {
          setProject(preferredProject || projects[0]?.data.id || "");
          setOpen(true);
          setError("");
          setNotice("");
          setPreview(null);
          setCsv("");
          setFileName("");
          setMode("skip");
        }}
      >
        CSV 가져오기
      </button>
      {notice && (
        <span role="status" className="muted">
          {notice}
        </span>
      )}
      {open && (
        <EditorDialog
          title="PRD CSV 가져오기"
          busy={busy}
          onClose={() => setOpen(false)}
        >
          <p>
            Notion에서 내보낸 CSV를 올리면 ID·기능명·상세 설명·정책·비고를 PRD에
            채웁니다. 원본 편집 정보는 별도로 보존하고 시스템 편집자는 가져온
            사용자로 기록합니다.
          </p>
          <div className="prd-fields">
            <label>
              대상 프로젝트
              <select
                aria-label="CSV 대상 프로젝트"
                value={project}
                disabled={busy}
                onChange={(e) => {
                  setProject(e.target.value);
                  setPreview(null);
                }}
              >
                {projects.map((p) => (
                  <option key={p.data.id} value={p.data.id}>
                    {p.data.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              CSV 파일
              <input
                aria-label="PRD CSV 파일"
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  setPreview(null);
                  setCsv("");
                  setFileName("");
                  setError("");
                  if (!file) return;
                  void run(async () => {
                    if (file.size > 1048576)
                      throw new Error("CSV 파일은 1 MiB 이하로 올려주세요.");
                    let content;
                    try {
                      content = new TextDecoder("utf-8", {
                        fatal: true,
                      }).decode(await file.arrayBuffer());
                    } catch {
                      throw new Error("UTF-8 형식의 CSV 파일을 올려주세요.");
                    }
                    setCsv(content);
                    setFileName(file.name);
                  });
                }}
              />
            </label>
            <small className="muted">
              UTF-8 CSV · 최대 1 MiB / 500개 항목 · ID와 기능명 열 필수 · 파일의
              줄바꿈과 링크를 보존합니다.
            </small>
            <label>
              같은 ID가 이미 있을 때
              <select
                aria-label="CSV 중복 처리"
                value={mode}
                disabled={busy}
                onChange={(e) => setMode(e.target.value as "skip" | "update")}
              >
                <option value="skip">기존 항목 유지 (건너뛰기)</option>
                <option value="update">CSV에 있는 열로 기존 PRD 수정</option>
              </select>
            </label>
          </div>
          <p className="muted">
            태스크·GitHub 이슈는 자동 생성하지 않으며, 기존 연결도 유지됩니다.
            CSV에 없는 상태·담당자·정책 참조는 수정하지 않습니다.
          </p>
          {error && (
            <div role="alert" className="alert">
              {error}
            </div>
          )}
          {preview && (
            <>
              <p role="status">
                총 {preview.counts.total}개 · 신규 {preview.counts.new}개 · 기존{" "}
                {preview.counts.existing}개 · 오류 {preview.counts.invalid}개
              </p>
              {preview.warnings.length > 0 && (
                <ul>
                  {preview.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              <div
                className="prd-table-scroll"
                role="region"
                aria-label="CSV 가져오기 미리보기"
                tabIndex={0}
              >
                <table className="prd-table">
                  <thead>
                    <tr>
                      {[
                        "행",
                        "ID",
                        "기능명",
                        "상세 설명",
                        "정책",
                        "비고",
                        "상태",
                        "담당자",
                        "원본 편집일시",
                        "원본 편집자",
                        "처리",
                      ].map((title) => (
                        <th key={title}>{title}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={row.row}>
                        <td>{row.row}</td>
                        <td>{row.data.sourceId}</td>
                        <td>{row.data.featureName}</td>
                        <td>{text(row.data.description)}</td>
                        <td>{text(row.data.policy)}</td>
                        <td>{text(row.data.remarks)}</td>
                        <td>{requirementStates[row.data.status]}</td>
                        <td>{row.data.assignee || "미지정"}</td>
                        <td>
                          {row.source.editedAt
                            ? new Date(row.source.editedAt).toLocaleString(
                                "ko-KR",
                              )
                            : "—"}
                        </td>
                        <td>{row.source.editor || "—"}</td>
                        <td>
                          {row.errors.length ? (
                            <span className="csv-row-error">
                              {row.errors.join(" ")}
                            </span>
                          ) : row.existing ? (
                            mode === "skip" ? (
                              "유지"
                            ) : (
                              "수정"
                            )
                          ) : (
                            "새로 등록"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              취소
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy || !csv || !project}
              onClick={() =>
                void run(async () =>
                  setPreview(
                    await api("requirements/import/preview", {
                      project,
                      fileName,
                      csv,
                    }),
                  ),
                )
              }
            >
              파일 미리보기
            </button>
            <button
              type="button"
              className="button"
              disabled={
                busy || !preview || preview.counts.invalid > 0 || !canWrite
              }
              onClick={() =>
                void run(async () => {
                  if (!preview) return;
                  const result = await api("requirements/import", {
                    project,
                    fileName,
                    csv,
                    mode,
                    previewHash: preview.previewHash,
                  });
                  setNotice(
                    `추가 ${result.created}개 · 수정 ${result.updated}개 · 건너뜀 ${result.skipped}개`,
                  );
                  setOpen(false);
                  setPreview(null);
                  setCsv("");
                  await onRefresh();
                })
              }
            >
              {busy ? "처리 중…" : "PRD에 가져오기"}
            </button>
          </div>
        </EditorDialog>
      )}
    </>
  );
}
