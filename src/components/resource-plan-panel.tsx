"use client";
import { useState } from "react";
import type { Planning } from "../core/planning";
import type { Stored, Task } from "../core/model";
import { dayNumber, dayString } from "../core/resources";
import {
  usePlanningAction,
  usePlanningData,
  type PlanningApi,
} from "./planning-hooks";
import EditorDialog from "./editor-dialog";
type Plan = Awaited<ReturnType<Planning["resources"]>>;
export default function ResourcePlanPanel({
  api,
  project,
  canWrite,
  viewerId,
  admin,
  tasks,
  onOpenTask,
  onRefresh,
}: {
  api: PlanningApi;
  project: string;
  canWrite: boolean;
  viewerId: string | null;
  admin: boolean;
  tasks: Stored<Task>[];
  onOpenTask: (task: Stored<Task>) => void;
  onRefresh: () => Promise<void>;
}) {
  const today = new Date().toLocaleDateString("sv-SE"),
    [from, setFrom] = useState(today),
    [to, setTo] = useState(dayString(dayNumber(today) + 13)),
    [offset, setOffset] = useState(0);
  const query = usePlanningData<Plan>(
    api,
    `planning/resources?${new URLSearchParams({ ...(project ? { project } : {}), from, to, offset: String(offset), limit: "50" })}`,
  );
  const action = usePlanningAction(api, async () => {
    query.reload();
    await onRefresh();
  });
  const [editing, setEditing] = useState<
      Plan["people"]["items"][number] | null
    >(null),
    [exceptions, setExceptions] = useState<{ date: string; hours: string }[]>(
      [],
    );
  const open = (id: string) => {
    const task = tasks.find((t) => t.data.id === id);
    if (task) onOpenTask(task);
  };
  return (
    <section className="planning-panel" aria-label="담당자 리소스 계획">
      <div className="section-title">
        <div>
          <h2>담당자 리소스 계획</h2>
          <p className="muted">
            태스크의 예상 공수를 근무일에 나누어 표시합니다. 실제 근무 기록과
            구분하며, 조회 가능한 프로젝트만 집계합니다.
          </p>
        </div>
      </div>
      <div className="planning-toolbar">
        <label>
          조회 시작
          <input
            aria-label="리소스 조회 시작"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label>
          조회 종료
          <input
            aria-label="리소스 조회 종료"
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <span className="tag">예정 / 가용 시간 · 최대 93일</span>
      </div>
      {(query.error || action.error) && !editing && (
        <p role="alert" className="alert">
          {action.error || query.error}
        </p>
      )}
      {action.notice && !editing && (
        <p role="status" className="success-note">
          {action.notice}
        </p>
      )}
      {query.loading && (
        <p className="muted">리소스 계획을 불러오는 중입니다…</p>
      )}
      {query.data && (
        <>
          <div
            className="planning-grid-scroll"
            role="region"
            aria-label="담당자별 예정 공수 표"
            tabIndex={0}
          >
            <table className="planning-resource-table">
              <thead>
                <tr>
                  <th>담당자</th>
                  {query.data.people.items[0]?.cells.map((c) => (
                    <th key={c.date}>
                      {c.date.slice(5)}
                      <small>
                        {
                          ["일", "월", "화", "수", "목", "금", "토"][
                            new Date(c.date + "T00:00:00Z").getUTCDay()
                          ]
                        }
                      </small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {query.data.people.items.map((row) => (
                  <tr key={row.person.id}>
                    <th>
                      <strong>{row.person.displayName}</strong>
                      <small>
                        @{row.person.githubLogin ?? row.person.login}
                      </small>
                      {canWrite && (admin || viewerId === row.person.id) && (
                        <button
                          className="text-button"
                          onClick={() => {
                            action.clear();
                            setEditing(row);
                            setExceptions(
                              Object.entries(row.capacity.exceptions).map(
                                ([date, hours]) => ({
                                  date,
                                  hours: String(hours),
                                }),
                              ),
                            );
                          }}
                        >
                          가용 시간 설정
                        </button>
                      )}
                    </th>
                    {row.cells.map((cell) => (
                      <td
                        key={cell.date}
                        className={
                          cell.overloaded
                            ? "resource-overloaded"
                            : cell.capacity === 0
                              ? "resource-off"
                              : "resource-available"
                        }
                      >
                        <strong>
                          {cell.planned} / {cell.capacity}
                        </strong>
                        {cell.overloaded && <small>초과 배정</small>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!query.data.people.total && (
            <p className="empty">
              이 범위에 배정할 수 있는 워크스페이스 구성원이 없습니다.
            </p>
          )}
          <div className="actions">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              이전 담당자
            </button>
            <span>
              {query.data.people.total}명 중 {query.data.people.items.length}명
              표시
            </span>
            <button
              disabled={!query.data.people.hasMore}
              onClick={() => setOffset(query.data!.people.nextOffset!)}
            >
              다음 담당자
            </button>
          </div>
          <div className="planning-summary-list">
            {query.data.people.items.map((row) => (
              <details key={row.person.id}>
                <summary>
                  {row.person.displayName} · 계획 작업 {row.tasks.length}개 ·
                  미산정 {row.unplannedCount}개
                </summary>
                <ul>
                  {row.tasks.map((t) => (
                    <li key={t.id}>
                      <button
                        className="text-button"
                        onClick={() => open(t.id)}
                      >
                        {t.title}
                      </button>
                      <small>
                        {t.startDate} ~ {t.dueDate} ·{" "}
                        {t.estimatedHours ?? "미산정"}시간
                        {t.inferredStart ? " · 마감일 기준 추정" : ""}
                      </small>
                    </li>
                  ))}
                  {row.unplanned.map((t) => (
                    <li key={t.id}>
                      <button
                        className="text-button"
                        onClick={() => open(t.id)}
                      >
                        {t.title}
                      </button>{" "}
                      · {t.reason}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
          <details>
            <summary>
              담당자 미매칭·미지정 {query.data.unmatchedCount}개
            </summary>
            <p className="muted">
              담당자 매칭에서 기존 이름을 계정에 연결하거나 태스크의 담당 계정을
              지정하세요. 최대 100개를 표시합니다.
            </p>
            <ul>
              {query.data.unmatched.map((t) => (
                <li key={t.id}>
                  <button className="text-button" onClick={() => open(t.id)}>
                    {t.title}
                  </button>{" "}
                  · {t.assignee || "미지정"}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      {editing && (
        <EditorDialog
          title="담당자 가용 시간"
          busy={action.busy}
          onClose={() => setEditing(null)}
        >
          <p>
            {editing.person.displayName}의 근무 요일과 가용 시간을 지정합니다.
            날짜별 예외는 기본 근무 시간보다 우선합니다.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              if (
                new Set(exceptions.map((x) => x.date)).size !==
                exceptions.length
              )
                return;
              const ok = await action.mutate(
                "planning/capacity",
                {
                  userId: editing.person.id,
                  revision: editing.capacityRevision,
                  hoursPerDay: Number(form.get("hoursPerDay")),
                  weekdays: form.getAll("weekdays").map(Number),
                  exceptions: Object.fromEntries(
                    exceptions.map((x) => [x.date, Number(x.hours)]),
                  ),
                },
                "가용 시간을 변경했습니다.",
              );
              if (ok) setEditing(null);
            }}
          >
            <fieldset disabled={action.busy}>
              <label>
                하루 가용 시간
                <input
                  name="hoursPerDay"
                  type="number"
                  min="0"
                  max="24"
                  step="0.25"
                  required
                  defaultValue={editing.capacity.hoursPerDay}
                />
              </label>
              <div className="planning-weekdays">
                {["일", "월", "화", "수", "목", "금", "토"].map((name, i) => (
                  <label key={name}>
                    <input
                      type="checkbox"
                      name="weekdays"
                      value={i}
                      defaultChecked={editing.capacity.weekdays.includes(i)}
                    />
                    {name}
                  </label>
                ))}
              </div>
              <h3>날짜별 예외</h3>
              {exceptions.map((entry, i) => (
                <div className="planning-exception" key={i}>
                  <input
                    aria-label={`예외 ${i + 1} 날짜`}
                    type="date"
                    required
                    value={entry.date}
                    onChange={(e) =>
                      setExceptions((old) =>
                        old.map((x, j) =>
                          j === i ? { ...x, date: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <input
                    aria-label={`예외 ${i + 1} 가용 시간`}
                    type="number"
                    min="0"
                    max="24"
                    step="0.25"
                    required
                    value={entry.hours}
                    onChange={(e) =>
                      setExceptions((old) =>
                        old.map((x, j) =>
                          j === i ? { ...x, hours: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setExceptions((old) => old.filter((_, j) => j !== i))
                    }
                  >
                    제거
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={exceptions.length >= 366}
                onClick={() =>
                  setExceptions([...exceptions, { date: "", hours: "0" }])
                }
              >
                ＋ 예외 날짜 추가
              </button>
            </fieldset>
            {new Set(exceptions.map((x) => x.date)).size !==
              exceptions.length && (
              <p role="alert">같은 날짜의 예외를 중복 등록할 수 없습니다.</p>
            )}
            {action.error && (
              <p role="alert" className="alert">
                {action.error}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                disabled={action.busy}
                onClick={() => setEditing(null)}
              >
                취소
              </button>
              <button className="button" disabled={action.busy}>
                가용 시간 저장
              </button>
            </div>
          </form>
        </EditorDialog>
      )}
    </section>
  );
}
