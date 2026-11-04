"use client";
import { useEffect, useRef, useState } from "react";
import type { ImpactKind, KnowledgeImpact } from "../core/knowledge-impact";

const groups: Record<ImpactKind, string> = {
  requirements: "PRD",
  tasks: "태스크",
  issues: "이슈",
  prs: "PR",
  policies: "의존 정책",
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
  active: "사용 중",
  deprecated: "사용 중단",
};
type OpenKind = "requirements" | "tasks" | "policies";
function pathLabel(path: { name: string }[], truncated?: boolean) {
  return path
    .map(
      (policy, index) =>
        `${truncated && index === path.length - 1 ? "… → " : ""}${policy.name}`,
    )
    .join(" → ");
}
export default function KnowledgeImpactPanel({
  id,
  api,
  onOpen,
}: {
  id: string;
  api: (path: string, body?: unknown) => Promise<any>;
  onOpen?: (kind: OpenKind, id: string) => void;
}) {
  const apiRef = useRef(api);
  apiRef.current = api;
  const [kind, setKind] = useState<ImpactKind>("requirements");
  const [project, setProject] = useState("");
  const [scope, setScope] = useState<"all" | "direct">("all");
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
      scope,
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
  }, [id, kind, project, scope, offset, retry]);
  const current = !loading && !error ? data : null;
  return (
    <section className="knowledge-impact" aria-label="연결 및 변경 영향">
      <h3>연결 항목 · 변경 검토 대상</h3>
      <p className="muted">
        PRD의 정책·용어 참조와 정책 의존관계를 따라 연결 항목을 모았습니다.
        변경할 내용이 있는지 각 항목을 검토하세요. GitHub 상태는 마지막 동기화
        기준입니다.
      </p>
      {data && (
        <p className="muted">
          저장된 문서 v{data.document.revision} · 최종 수정{" "}
          {new Date(data.document.updatedAt).toLocaleString("ko-KR")}
        </p>
      )}
      {data?.policyRelations && (
        <details className="impact-policy-relations">
          <summary>
            정책 관계 · 기준 정책 {data.policyRelations.dependencies.length}개 ·
            의존 정책 {data.policyRelations.dependentCount}개
          </summary>
          <p className="muted">이 정책이 따르는 기준 정책</p>
          {data.policyRelations.dependencies.length ? (
            <div className="reference-selected">
              {data.policyRelations.dependencies.map((policy) =>
                onOpen ? (
                  <button
                    key={policy.id}
                    type="button"
                    className="reference-chip"
                    onClick={() => onOpen("policies", policy.id)}
                  >
                    {policy.name} ↗
                  </button>
                ) : (
                  <span key={policy.id} className="reference-chip">
                    {policy.name}
                  </span>
                ),
              )}
            </div>
          ) : (
            <p className="muted">등록된 기준 정책이 없습니다.</p>
          )}
          <p className="muted">
            이 정책이 바뀌면 의존 정책을 참조하는 PRD도 함께 검토하세요.
          </p>
        </details>
      )}
      <div className="impact-toolbar">
        <div className="impact-groups" role="group" aria-label="연결 항목 종류">
          {Object.entries(groups)
            .filter(
              ([key]) => key !== "policies" || data?.document.kind === "policy",
            )
            .map(([key, label]) => (
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
        {data?.document.kind === "policy" && (
          <select
            aria-label="정책 연결 범위"
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as "all" | "direct");
              setOffset(0);
            }}
          >
            <option value="all">직접 참조 + 의존 정책 포함</option>
            <option value="direct">직접 참조만</option>
          </select>
        )}
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
                연결된 {groups[kind]}가 없습니다.{" "}
                {kind === "policies"
                  ? "다른 정책의 편집 화면에서 이 정책을 기준 정책으로 연결하면 표시됩니다."
                  : "PRD 편집에서 관련 정책·용어를 지정하고 태스크와 GitHub 항목을 연결하세요."}
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
                        item.kind === "tasks" ||
                        item.kind === "policies") ? (
                        <button
                          type="button"
                          className="text-button impact-title"
                          onClick={() => onOpen(item.kind as OpenKind, item.id)}
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
                  {item.policyPath && (
                    <p className="impact-evidence">
                      의존 경로:{" "}
                      {pathLabel(item.policyPath, item.policyPathTruncated)}
                    </p>
                  )}
                  {item.references.some((ref) => ref.policyPath) && (
                    <p className="impact-evidence">
                      정책 연결:{" "}
                      {Array.from(
                        new Set(
                          item.references
                            .filter((ref) => ref.policyPath)
                            .map(
                              (ref) =>
                                `${pathLabel(ref.policyPath!, ref.policyPathTruncated)}${ref.policyDistance ? " (간접 참조)" : " (직접 참조)"}`,
                            ),
                        ),
                      ).join(" · ")}
                    </p>
                  )}
                  {item.kind !== "requirements" &&
                    item.references.length > 0 && (
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
