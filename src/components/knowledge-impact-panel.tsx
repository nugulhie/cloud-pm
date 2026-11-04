"use client";
import { useEffect, useRef, useState } from "react";
import type { ImpactKind, KnowledgeImpact } from "../core/knowledge-impact";

const groups: Record<ImpactKind, string> = {
  requirements: "PRD",
  tasks: "태스크",
  issues: "이슈",
  prs: "PR",
};
const statuses: Record<string, string> = {
  draft: "초안",
  in_review: "검토 중",
  approved: "승인",
  in_progress: "진행 중",
  completed: "완료",
  on_hold: "보류",
  backlog: "대기",
  ready: "준비 완료",
  done: "완료",
  canceled: "취소",
  open: "열림",
  closed: "닫힘",
  merged: "머지 완료",
  unknown: "원본 상태 미수집",
};
export default function KnowledgeImpactPanel({
  id,
  api,
  onOpen,
}: {
  id: string;
  api: (path: string, body?: unknown) => Promise<any>;
  onOpen?: (kind: "requirements" | "tasks", id: string) => void;
}) {
  const apiRef = useRef(api);
  apiRef.current = api;
  const [kind, setKind] = useState<ImpactKind>("requirements");
  const [project, setProject] = useState("");
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<KnowledgeImpact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      id,
      kind,
      offset: String(offset),
      limit: "40",
    });
    if (project) params.set("project", project);
    void apiRef
      .current(`knowledge/impact?${params}`)
      .then((response: KnowledgeImpact) => {
        if (active) setData(response);
      })
      .catch((e: unknown) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "연결 항목을 불러오지 못했습니다.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, kind, project, offset, retry]);
  const current = !loading && !error ? data : null;
  return (
    <section className="knowledge-impact" aria-label="연결 및 변경 영향">
      <h3>연결 항목 · 변경 검토 대상</h3>
      <p className="muted">
        PRD에 지정한 관련 정책·용어와 연결 태스크의 하위 작업, 승인된 GitHub
        연결을 모았습니다. 변경할 내용이 있는지 각 항목을 검토하세요. GitHub
        상태는 마지막 동기화 기준입니다.
      </p>
      {data && (
        <p className="muted">
          저장된 문서 v{data.document.revision} · 최종 수정{" "}
          {new Date(data.document.updatedAt).toLocaleString("ko-KR")}
        </p>
      )}
      <div className="impact-toolbar">
        <div className="impact-groups" role="group" aria-label="연결 항목 종류">
          {Object.entries(groups).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={kind === key}
              onClick={() => {
                setKind(key as ImpactKind);
                setOffset(0);
              }}
            >
              {label}
              {current ? ` ${current.summary[key as ImpactKind]}` : ""}
            </button>
          ))}
        </div>
        <select
          aria-label="영향 범위 프로젝트"
          value={project}
          onChange={(e) => {
            setProject(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">모든 관련 프로젝트</option>
          {(data?.projects ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div aria-live="polite" aria-busy={loading}>
        {loading && (
          <p className="muted" role="status">
            연결 항목을 불러오는 중…
          </p>
        )}
        {error && (
          <div className="alert" role="alert">
            {error}{" "}
            <button type="button" onClick={() => setRetry((r) => r + 1)}>
              다시 시도
            </button>
          </div>
        )}
        {current && (
          <>
            <p className="muted">
              {current.summary.projects}개 프로젝트 · {groups[kind]}{" "}
              {current.page.total}개
            </p>
            {!current.page.items.length && (
              <p className="empty">
                연결된 {groups[kind]}가 없습니다. PRD 편집에서 관련 정책·용어를
                지정하고 태스크와 GitHub 항목을 연결하세요.
              </p>
            )}
            <ul className="impact-items">
              {current.page.items.map((item) => (
                <li key={item.id}>
                  <div className="impact-item-heading">
                    <div>
                      {item.label && (
                        <small className="muted">{item.label}</small>
                      )}
                      {onOpen &&
                      (item.kind === "requirements" ||
                        item.kind === "tasks") ? (
                        <button
                          type="button"
                          className="text-button impact-title"
                          onClick={() =>
                            onOpen(
                              item.kind as "requirements" | "tasks",
                              item.id,
                            )
                          }
                        >
                          {item.title}
                        </button>
                      ) : (
                        <strong className="impact-title">{item.title}</strong>
                      )}
                    </div>
                    <span className="tag">
                      {statuses[item.status] ?? item.status}
                    </span>
                  </div>
                  <p className="muted">
                    {item.projects.map((p) => p.name).join(", ")} · 담당자{" "}
                    {item.assignees.join(", ") || "미지정"}
                  </p>
                  <p className="muted">
                    마지막 수정·활동{" "}
                    {new Date(item.updatedAt).toLocaleString("ko-KR")}
                  </p>
                  {item.kind !== "requirements" && (
                    <p className="impact-evidence">
                      근거:{" "}
                      {item.references
                        .map(
                          (ref) =>
                            `${ref.label} ${ref.title}${ref.via === "subtask" ? " (하위 태스크)" : ref.via === "published_issue" ? " (PRD 발행)" : ""}`,
                        )
                        .join(" · ")}
                      {item.referenceCount > item.references.length
                        ? ` 외 ${item.referenceCount - item.references.length}개 연결`
                        : ""}
                    </p>
                  )}
                  {item.url && /^https?:\/\//i.test(item.url) && (
                    <a href={item.url} target="_blank" rel="noreferrer">
                      GitHub에서 열기 ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
            {current.page.total > current.page.limit && (
              <div className="impact-pagination">
                <button
                  type="button"
                  disabled={offset === 0}
                  onClick={() =>
                    setOffset(Math.max(0, offset - current.page.limit))
                  }
                >
                  이전
                </button>
                <span>
                  {offset + 1}–
                  {Math.min(
                    offset + current.page.items.length,
                    current.page.total,
                  )}{" "}
                  / {current.page.total}
                </span>
                <button
                  type="button"
                  disabled={!current.page.hasMore}
                  onClick={() => {
                    if (current.page.nextOffset !== null)
                      setOffset(current.page.nextOffset);
                  }}
                >
                  다음
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
