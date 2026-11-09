"use client";
import { useState } from "react";
import { usePlanningData, type PlanningApi } from "./planning-hooks";
import type { Service } from "../core/service";
export default function TrashPanel({
  api,
  canWrite,
  onRestored,
}: {
  api: PlanningApi;
  canWrite: boolean;
  onRestored: () => Promise<void>;
}) {
  const [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const query = usePlanningData<Awaited<ReturnType<Service["listTrash"]>>>(
    api,
    `trash?offset=${offset}`,
  );
  return (
    <section aria-label="휴지통">
      <h2>삭제한 항목</h2>
      <p className="muted">
        삭제 당시 함께 처리한 하위 항목·댓글·연결도 복구합니다. GitHub 원본은
        변경하지 않습니다.
      </p>
      {(query.error || notice) && (
        <p role={query.error ? "alert" : "status"}>{query.error || notice}</p>
      )}
      {query.loading && <p role="status">삭제한 항목을 불러오는 중…</p>}
      {query.data?.items.map((item) => (
        <article className="trash-row" key={item.id}>
          <div>
            <strong>{item.names.join(", ")}</strong>
            <p>
              {item.count}개 항목 · {item.actor} ·{" "}
              {new Date(item.deletedAt).toLocaleString("ko-KR")}
            </p>
          </div>
          <button
            disabled={!canWrite || busy}
            onClick={async () => {
              setBusy(true);
              setNotice("");
              try {
                const result = await api("trash/restore", { id: item.id });
                setNotice(`${result.restored}개 항목을 복구했습니다.`);
                await query.reload();
                await onRestored();
              } catch (e) {
                setNotice(
                  e instanceof Error ? e.message : "복구하지 못했습니다.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            복구
          </button>
        </article>
      ))}
      {query.data && !query.data.items.length && (
        <p className="empty">현재 조회 범위에 복구할 항목이 없습니다.</p>
      )}
      <div className="actions">
        <button
          disabled={busy || offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 20))}
        >
          이전
        </button>
        <button
          disabled={busy || query.data?.nextOffset == null}
          onClick={() => setOffset(query.data!.nextOffset!)}
        >
          다음
        </button>
      </div>
    </section>
  );
}
