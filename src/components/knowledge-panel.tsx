"use client";
import { createId } from "../core/browser-id";
import { useRef, useState, type FormEvent } from "react";
import { EditorDialog } from "./requirements-panel";
import MarkdownBody from "./markdown-body";
import { knowledgeStates, type KnowledgeEntry } from "../core/knowledge-model";
import type { Stored } from "../core/model";
export default function KnowledgePanel({
  kind,
  rows,
  canWrite,
  api,
  onRefresh,
}: {
  kind: "policy" | "glossary";
  rows: Stored<KnowledgeEntry>[];
  canWrite: boolean;
  api: (path: string, body?: unknown) => Promise<any>;
  onRefresh: () => Promise<void>;
}) {
  const title = kind === "policy" ? "정책" : "용어",
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [category, setCategory] = useState("");
  const [editing, setEditing] = useState<
      Stored<KnowledgeEntry> | null | undefined
    >(undefined),
    [deleting, setDeleting] = useState<Stored<KnowledgeEntry> | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const pending = useRef(false),
    entries = rows.filter((r) => r.data.kind === kind),
    visible = entries
      .filter(
        (r) =>
          (!status || r.data.status === status) &&
          (!category || r.data.category === category) &&
          (!query ||
            `${r.data.name} ${r.data.content} ${r.data.aliases.join(" ")} ${r.data.owner}`
              .toLowerCase()
              .includes(query.toLowerCase())),
      )
      .sort((a, b) => a.data.name.localeCompare(b.data.name, "ko"));
  async function run(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리하지 못했습니다.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function close() {
    setEditing(undefined);
    setDeleting(null);
    setError("");
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    await run(async () => {
      await api("knowledge", {
        revision: editing?.revision,
        data: {
          id: editing?.data.id ?? createId(),
          kind,
          name: String(f.get("name")),
          content: String(f.get("content")),
          category: String(f.get("category")),
          aliases: String(f.get("aliases") ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          owner: String(f.get("owner")),
          remarks: String(f.get("remarks")),
          status: String(f.get("status")),
        },
      });
      setEditing(undefined);
      setNotice(`${title}을 저장했습니다.`);
    });
  }
  return (
    <section className="knowledge-panel">
      <div className="section-title">
        <div>
          <h2>
            {kind === "policy" ? "정책 저장소" : "용어집 · Glossary Store"}
          </h2>
          <p className="muted">
            {kind === "policy"
              ? "조직의 운영 기준과 예외 규칙을 한곳에서 관리하세요."
              : "팀에서 사용하는 용어·약어·정의를 함께 정리하세요."}
          </p>
        </div>
        <button
          className="button"
          disabled={!canWrite || busy}
          onClick={() => {
            setEditing(null);
            setError("");
          }}
        >
          ＋ {title} 등록
        </button>
      </div>
      <div className="prd-toolbar">
        <input
          aria-label={`${title} 검색`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            kind === "policy"
              ? "정책명·내용·담당자 검색"
              : "용어·별칭·정의 검색"
          }
        />
        <select
          aria-label={`${title} 상태 필터`}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">모든 상태</option>
          {Object.entries(knowledgeStates).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label={`${title} 분류 필터`}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">모든 분류</option>
          {[
            ...new Set(entries.map((r) => r.data.category).filter(Boolean)),
          ].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <span className="muted">{visible.length}개</span>
      </div>
      {notice && (
        <div className="demo-banner" role="status">
          {notice}
        </div>
      )}
      {error && editing === undefined && !deleting && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <div className="knowledge-list">
        {visible.map((row) => (
          <article className="knowledge-card" key={row.data.id}>
            <div className="section-title">
              <h3>{row.data.name}</h3>
              <span className="tag">{knowledgeStates[row.data.status]}</span>
            </div>
            <p className="muted">
              {row.data.category || "미분류"} · 담당자{" "}
              {row.data.owner || "미지정"}
              {row.data.aliases.length
                ? ` · 별칭: ${row.data.aliases.join(", ")}`
                : ""}
            </p>
            <details>
              <summary>
                {kind === "policy" ? "정책 내용 보기" : "용어 정의 보기"}
              </summary>
              <MarkdownBody body={row.data.content} repository="" />
              {row.data.remarks && (
                <p className="muted">비고: {row.data.remarks}</p>
              )}
            </details>
            <div className="knowledge-card-footer">
              <small className="muted">
                {new Date(row.updatedAt).toLocaleString("ko-KR")} ·{" "}
                {row.data.editor}
              </small>
              <div className="actions">
                <button
                  className="text-button"
                  onClick={() => {
                    setEditing(row);
                    setError("");
                  }}
                >
                  {canWrite ? "편집" : "상세 보기"}
                </button>
                {canWrite && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setDeleting(row);
                      setError("");
                    }}
                  >
                    삭제
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {!visible.length && (
        <div className="empty empty-state">
          {query || status || category ? (
            <>
              <strong>검색 조건에 맞는 {title}이 없습니다.</strong>
              <button
                onClick={() => {
                  setQuery("");
                  setStatus("");
                  setCategory("");
                }}
              >
                검색 초기화
              </button>
            </>
          ) : (
            `등록된 ${title}이 없습니다.`
          )}
        </div>
      )}
      <p className="muted prd-footnote">
        현재 워크스페이스의 구성원에게 공유됩니다. 변경 이력과 최종 편집 정보는
        자동 기록됩니다.
      </p>
      {editing !== undefined && (
        <EditorDialog
          title={`${title} ${editing ? "편집" : "등록"}`}
          busy={busy}
          onClose={close}
        >
          <form onSubmit={save}>
            <fieldset className="prd-fields" disabled={busy || !canWrite}>
              <label>
                {title}명
                <input
                  name="name"
                  required
                  maxLength={200}
                  defaultValue={editing?.data.name}
                  autoFocus
                />
              </label>
              <div className="form-grid">
                <label>
                  분류
                  <input
                    name="category"
                    maxLength={100}
                    defaultValue={editing?.data.category}
                    placeholder="예: 회원·결제·보안"
                  />
                </label>
                <label>
                  담당자
                  <input
                    name="owner"
                    maxLength={100}
                    defaultValue={editing?.data.owner}
                  />
                </label>
              </div>
              {kind === "glossary" && (
                <label>
                  별칭·약어
                  <input
                    name="aliases"
                    defaultValue={editing?.data.aliases.join(", ")}
                    placeholder="쉼표로 구분 · 예: PRD, 제품 요구사항 문서"
                    maxLength={3000}
                  />
                </label>
              )}
              <label>
                {kind === "policy" ? "정책 내용" : "정의"}
                <textarea
                  name="content"
                  aria-label={kind === "policy" ? "정책 내용" : "정의"}
                  required
                  rows={8}
                  maxLength={12000}
                  defaultValue={editing?.data.content}
                  placeholder="Markdown으로 작성할 수 있습니다."
                />
              </label>
              <label>
                비고
                <textarea
                  name="remarks"
                  aria-label="비고"
                  rows={3}
                  maxLength={2000}
                  defaultValue={editing?.data.remarks}
                />
              </label>
              <label>
                상태
                <select
                  name="status"
                  aria-label="상태"
                  defaultValue={editing?.data.status ?? "draft"}
                >
                  {Object.entries(knowledgeStates).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={close}
              >
                닫기
              </button>
              {canWrite && (
                <button className="button" disabled={busy}>
                  {title} 저장
                </button>
              )}
            </div>
          </form>
        </EditorDialog>
      )}
      {deleting && (
        <EditorDialog title={`${title} 삭제 확인`} busy={busy} onClose={close}>
          <p>
            ‘{deleting.data.name}’ 항목을 삭제할까요? PRD에서 참조 중인 항목은
            삭제할 수 없습니다. 사용 중단 상태로 보관할 수 있습니다.
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
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api("knowledge/delete", {
                    id: deleting.data.id,
                    revision: deleting.revision,
                  });
                  setDeleting(null);
                  setNotice(`${title}을 삭제했습니다.`);
                })
              }
            >
              삭제 확인
            </button>
          </div>
        </EditorDialog>
      )}
    </section>
  );
}
