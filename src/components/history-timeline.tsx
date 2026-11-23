"use client";
import MarkdownBody from "./markdown-lazy";
import { Fragment, type ReactNode, useDeferredValue, useState } from "react";
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
const pageSize = 50;
const dayFormat = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});
const timeFormat = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
});
// Markdown bodies are parsed only after the reader opens them.
function LazyDetails({
  summary,
  children,
}: {
  summary: string;
  children: () => ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details onToggle={(e) => e.currentTarget.open && setOpened(true)}>
      <summary>{summary}</summary>
      {opened && children()}
    </details>
  );
}
export default function HistoryTimeline({ events }: { events: ChangeEvent[] }) {
  const [kind, setKind] = useState(""),
    [search, setSearch] = useState(""),
    [limit, setLimit] = useState(pageSize);
  const query = useDeferredValue(search).toLowerCase();
  const visible = events.filter(
    (e) =>
      (!kind || e.kind === kind) &&
      (!query ||
        `${e.actor} ${e.target} ${e.targetId}`.toLowerCase().includes(query)),
  );
  // The ledger carries one line per change. A repeated timestamp belongs to
  // the day it groups, not to every row underneath it.
  const days: { day: string; rows: ChangeEvent[] }[] = [];
  for (const event of visible.slice(0, limit)) {
    const day = dayFormat.format(new Date(event.at));
    const last = days.at(-1);
    if (last?.day === day) last.rows.push(event);
    else days.push({ day, rows: [event] });
  }
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
            onChange={(e) => {
              setKind(e.target.value);
              setLimit(pageSize);
            }}
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
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(pageSize);
            }}
          />
        </div>
      </div>
      {visible.length ? (
        <div className="history-ledger">
          <div className="history-ledger-head" aria-hidden="true">
            <span>시각</span>
            <span>종류</span>
            <span>대상과 작업자</span>
          </div>
          {days.map(({ day, rows }) => (
            <Fragment key={day}>
              <h3 className="history-day">
                {day} <span>{rows.length}건</span>
              </h3>
              {rows.map((e) => {
                const verb =
                  e.action === "created"
                    ? "등록"
                    : e.action === "deleted"
                      ? "삭제"
                      : "수정";
                return (
                  <article key={e.id} className="history-event">
                    <time className="history-time" dateTime={e.at}>
                      {timeFormat.format(new Date(e.at))}
                    </time>
                    <span className="badge">{kinds[e.kind]}</span>
                    <div className="history-what">
                      <h3>{e.target}</h3>
                      <p>
                        <strong>{e.actor}</strong>님이 {verb}했습니다.{" "}
                        <code>{e.targetId}</code>
                      </p>
                    </div>
                    {e.changes.length > 0 && (
                      <details className="history-changes">
                        <summary>변경 내용 {e.changes.length}개</summary>
                        <dl>
                          {e.changes.map((c, i) => (
                            <div key={i}>
                              <dt>{c.field}</dt>
                              <dd>
                                {c.markdown ? (
                                  <LazyDetails summary={`${c.field} 펼치기`}>
                                    {() => (
                                      <>
                                        {e.action !== "created" && c.before && (
                                          <LazyDetails summary="이전 본문">
                                            {() => (
                                              <MarkdownBody
                                                body={c.before}
                                                repository={e.repository ?? ""}
                                              />
                                            )}
                                          </LazyDetails>
                                        )}
                                        <MarkdownBody
                                          body={c.after}
                                          repository={e.repository ?? ""}
                                        />
                                      </>
                                    )}
                                  </LazyDetails>
                                ) : e.action === "created" ||
                                  c.before === "미지정" ? (
                                  <span className="after">
                                    {c.after === "미지정" ? "값 없음" : c.after}
                                  </span>
                                ) : (
                                  <>
                                    <span className="before">
                                      <span className="sr-only">변경 전 </span>
                                      {c.before}
                                    </span>
                                    <span aria-hidden="true"> → </span>
                                    <span className="after">
                                      <span className="sr-only">변경 후 </span>
                                      {c.after === "미지정"
                                        ? "값 제거"
                                        : c.after}
                                    </span>
                                  </>
                                )}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                    )}
                  </article>
                );
              })}
            </Fragment>
          ))}
        </div>
      ) : (
        <div className="empty">표시할 변경 이력이 없습니다.</div>
      )}
      {visible.length > limit && (
        <button
          className="button secondary"
          onClick={() => setLimit(limit + pageSize)}
        >
          변경 이력 {Math.min(pageSize, visible.length - limit)}개 더 보기
        </button>
      )}
    </section>
  );
}
