"use client";
import { useState } from "react";
import type { Stored, Task } from "../core/model";
import { taskToday } from "../core/task-date";
import { dayNumber, dayString } from "../core/resources";
export default function TaskTimeline({
  tasks,
  onOpen,
}: {
  tasks: Stored<Task>[];
  onOpen: (id: string) => void;
}) {
  const [start, setStart] = useState(() => dayNumber(taskToday()) - 3),
    length = 28,
    end = start + length - 1;
  const dated = tasks.filter((t) => t.data.startDate && t.data.dueDate),
    visible = dated
      .filter(
        (t) =>
          dayNumber(t.data.dueDate!) >= start &&
          dayNumber(t.data.startDate!) <= end,
      )
      .slice(0, 100);
  return (
    <section aria-label="태스크 타임라인">
      <div className="section-title">
        <h3>
          {dayString(start)} ~ {dayString(end)}
        </h3>
        <div className="actions">
          <button aria-label="이전 2주" onClick={() => setStart(start - 14)}>
            ←
          </button>
          <button onClick={() => setStart(dayNumber(taskToday()) - 3)}>
            오늘
          </button>
          <button aria-label="다음 2주" onClick={() => setStart(start + 14)}>
            →
          </button>
        </div>
      </div>
      <div
        className="task-timeline-scroll"
        tabIndex={0}
        aria-label="타임라인 가로 스크롤"
      >
        <div className="task-timeline-grid">
          <div className="timeline-name">태스크</div>
          <div className="timeline-weeks">
            {[0, 7, 14, 21].map((n) => (
              <span key={n}>{dayString(start + n).slice(5)}</span>
            ))}
          </div>
          {visible.map(({ data: t }) => {
            const left = Math.max(0, dayNumber(t.startDate!) - start),
              right = Math.min(length, dayNumber(t.dueDate!) - start + 1);
            return (
              <div className="timeline-row" key={t.id}>
                <button
                  className="timeline-name text-button"
                  onClick={() => onOpen(t.id)}
                >
                  {t.title}
                </button>
                <div className="timeline-track">
                  <button
                    className={`timeline-bar ${t.status}`}
                    style={{
                      left: `${(left / length) * 100}%`,
                      width: `${(Math.max(1, right - left) / length) * 100}%`,
                    }}
                    aria-label={`${t.title}: ${t.startDate}부터 ${t.dueDate}까지`}
                    title={`${t.startDate} ~ ${t.dueDate}`}
                    onClick={() => onOpen(t.id)}
                  >
                    {t.startDate!.slice(5)}–{t.dueDate!.slice(5)}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {!visible.length && (
        <p className="muted">선택한 기간에 배치된 태스크가 없습니다.</p>
      )}
      <p className="muted">
        시작일·마감일이 모두 있는 작업을 최대 100개 표시합니다. 일정이 미지정된
        작업 {tasks.length - dated.length}개는 아래 목록에서 확인하세요.
      </p>
    </section>
  );
}
