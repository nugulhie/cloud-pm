"use client";
import MarkdownBody from "./markdown-body";
import { useState } from "react";
import type { ChangeEvent } from "../core/history";
const kinds: Record<string, string> = {
  project: "프로젝트",
  feature: "기능",
  requirement: "PRD",
  milestone: "마일스톤",
  release: "릴리스",
  "task-review": "기획 검수",
  "change-review": "변경 검토",
  "change-target": "검토 대상",
  knowledge: "정책·용어집",
  task: "태스크",
  github: "PR·이슈",
  link: "연결",
  sync: "동기화",
  evaluation: "완료 판정",
};
export default function HistoryTimeline({ events }: { events: ChangeEvent[] }) {
  const [kind, setKind] = useState(""),
    [search, setSearch] = useState("");
  const visible = events.filter(
    (e) =>
      (!kind || e.kind === kind) &&
      (!search ||
        `${e.actor} ${e.target} ${e.targetId}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  return (
    <section className="history-timeline">
      <div className="section-title">
        <h2>
          활동 기록 <span>{visible.length}</span>
        </h2>
        <div className="history-filters">
          <select
            aria-label="변경 종류"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">모든 활동</option>
            {Object.entries(kinds).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input
            aria-label="변경 이력 검색"
            placeholder="작업자 또는 대상 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      {visible.map((e) => (
        <article key={e.id} className="history-event">
          <span className="history-mark">
            {e.action === "created" ? "+" : e.action === "deleted" ? "−" : "↻"}
          </span>
          <div className="history-content">
            <div className="history-event-top">
              <span className="badge">{kinds[e.kind]}</span>
              <time dateTime={e.at}>
                {new Date(e.at).toLocaleString("ko-KR")}
              </time>
            </div>
            <h3>{e.target}</h3>
            <p>
              <strong>{e.actor}</strong>님이{" "}
              {e.action === "created"
                ? "등록"
                : e.action === "deleted"
                  ? "삭제"
                  : "수정"}
              했습니다. <code>{e.targetId}</code>
            </p>
            {e.changes.length > 0 && (
              <details open={e.kind === "task" || e.kind === "project"}>
                <summary>변경 내용 {e.changes.length}개</summary>
                <dl>
                  {e.changes.map((c, i) => (
                    <div key={i}>
                      <dt>{c.field}</dt>
                      <dd>
                        {c.markdown ? (
                          <details>
                            <summary>{c.field} 펼치기</summary>
                            {e.action !== "created" && c.before && (
                              <details>
                                <summary>이전 본문</summary>
                                <MarkdownBody
                                  body={c.before}
                                  repository={e.repository ?? ""}
                                />
                              </details>
                            )}
                            <MarkdownBody
                              body={c.after}
                              repository={e.repository ?? ""}
                            />
                          </details>
                        ) : e.action === "created" || c.before === "미지정" ? (
                          <span className="after">
                            {c.after === "미지정" ? "값 없음" : c.after}
                          </span>
                        ) : (
                          <>
                            <span className="before">{c.before}</span>
                            <span aria-label="에서"> → </span>
                            <span className="after">
                              {c.after === "미지정" ? "값 제거" : c.after}
                            </span>
                          </>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </div>
        </article>
      ))}
      {!visible.length && (
        <div className="empty">표시할 변경 이력이 없습니다.</div>
      )}
    </section>
  );
}
