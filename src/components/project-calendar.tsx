"use client";
import { useState } from "react";
import type { Project, Stored } from "../core/model";
export default function ProjectCalendar({
  projects,
  onManage,
}: {
  projects: Stored<Project>[];
  onManage: () => void;
}) {
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const year = month.getFullYear(),
    m = month.getMonth(),
    offset = new Date(year, m, 1).getDay(),
    count = new Date(year, m + 1, 0).getDate();
  const date = (day: number) =>
    `${year}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return (
    <section className="calendar-panel">
      <div className="section-title">
        <h2>
          프로젝트 일정 · {year}년 {m + 1}월
        </h2>
        <div className="bulk-toolbar">
          <button
            aria-label="이전 달"
            onClick={() => setMonth(new Date(year, m - 1, 1))}
          >
            ←
          </button>
          <button
            onClick={() =>
              setMonth(
                new Date(new Date().getFullYear(), new Date().getMonth(), 1),
              )
            }
          >
            이번 달
          </button>
          <button
            aria-label="다음 달"
            onClick={() => setMonth(new Date(year, m + 1, 1))}
          >
            →
          </button>
          <button onClick={onManage}>일정 편집</button>
        </div>
      </div>
      <div
        className="calendar-scroll"
        tabIndex={0}
        role="region"
        aria-label="월간 일정 캘린더"
      >
        <div className="calendar-grid">
          {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
            <strong key={day}>{day}</strong>
          ))}
          {Array.from({ length: offset }, (_, i) => (
            <div key={`blank-${i}`} className="calendar-day empty-day" />
          ))}
          {Array.from({ length: count }, (_, i) => {
            const day = i + 1,
              key = date(day);
            return (
              <div
                key={key}
                className={`calendar-day ${key === new Date().toLocaleDateString("sv-SE") ? "today" : ""}`}
              >
                <time dateTime={key}>{day}</time>
                {projects
                  .filter((p) => {
                    const start = p.data.startDate ?? p.data.endDate,
                      end = p.data.endDate ?? p.data.startDate;
                    return start && end && start <= key && key <= end;
                  })
                  .map((p) => (
                    <button
                      title={`${p.data.name}: ${p.data.startDate ?? "미설정"} ~ ${p.data.endDate ?? "미설정"}`}
                      onClick={onManage}
                      key={p.data.id}
                    >
                      {p.data.name}
                      {p.data.startDate === key
                        ? " · 시작"
                        : p.data.endDate === key
                          ? " · 종료"
                          : ""}
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
      </div>
      <p className="calendar-note">
        시작일·종료일 중 하나만 지정하면 해당 날짜에 표시됩니다. 일정은 프로젝트
        관리에서 변경할 수 있습니다.
      </p>
      {projects.filter((p) => !p.data.startDate && !p.data.endDate).length >
        0 && (
        <p className="calendar-unscheduled">
          일정 미설정:{" "}
          {projects
            .filter((p) => !p.data.startDate && !p.data.endDate)
            .map((p) => p.data.name)
            .join(", ")}
        </p>
      )}
    </section>
  );
}
