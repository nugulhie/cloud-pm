"use client";
import { usePlanningData, type PlanningApi } from "./planning-hooks";
import type { operationStatus } from "../operations/status";
export default function OperationsStatus({ api }: { api: PlanningApi }) {
  const query = usePlanningData<Awaited<ReturnType<typeof operationStatus>>>(
    api,
    "operations",
  );
  return (
    <section className="workflow-card">
      <div className="section-title">
        <h2>동기화·백업·서버 상태</h2>
        <button onClick={query.reload}>운영 상태 새로고침</button>
      </div>
      {query.error && <p role="alert">{query.error}</p>}
      {query.data && (
        <>
          <div className="pm-summary-counts">
            {query.data.queue.map((q) => (
              <div key={q.status}>
                <span>
                  {{
                    pending: "대기",
                    running: "실행",
                    completed: "완료",
                    failed: "실패",
                  }[q.status] ?? q.status}
                </span>
                <strong>{q.count}</strong>
              </div>
            ))}
          </div>
          {query.data.warnings.map((w) => (
            <p key={w} className="alert" role="alert">
              {w}
            </p>
          ))}
          <p>
            백업:{" "}
            {!query.data.backupConfigured
              ? "미설정"
              : query.data.backup?.ok && query.data.backup.verified
                ? "격리 복원 검증 완료"
                : "확인 필요"}{" "}
            · 최근 성공{" "}
            {query.data.backup?.lastSuccessAt
              ? new Date(query.data.backup.lastSuccessAt).toLocaleString(
                  "ko-KR",
                )
              : "없음"}
          </p>
          <p>
            외부 보관: {query.data.backup?.offsite ? "완료" : "미확인"} · 디스크
            사용률{" "}
            {query.data.health
              ? `${query.data.health.diskUsedPercent}%`
              : "미확인"}
          </p>
          <details>
            <summary>저장소별 누락 보정 상태</summary>
            {query.data.checkpoints.map((c) => (
              <p key={c.repository}>
                {c.repository} · 최근 보정{" "}
                {c.lastSuccessAt
                  ? new Date(c.lastSuccessAt).toLocaleString("ko-KR")
                  : "없음"}{" "}
                ·{" "}
                {c.availability === "unavailable"
                  ? "원본 접근 확인 필요"
                  : c.availability === "deleted"
                    ? "삭제 확인"
                    : "연결 확인"}
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
