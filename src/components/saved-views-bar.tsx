"use client";
import { useState } from "react";
import type { Stored } from "../core/model";
import type {
  TaskFilters,
  SavedView,
  Sprint,
  PlanningPerson,
} from "../core/planning-model";
import { createId } from "../core/browser-id";
import {
  usePlanningAction,
  usePlanningData,
  type PlanningApi,
} from "./planning-hooks";
import EditorDialog from "./editor-dialog";
export default function SavedViewsBar({
  api,
  filters,
  onApply,
  viewerId,
  canWrite,
  admin,
}: {
  api: PlanningApi;
  filters: TaskFilters;
  onApply: (filters: TaskFilters) => void;
  viewerId: string | null;
  canWrite: boolean;
  admin: boolean;
}) {
  const query = usePlanningData<Stored<SavedView>[]>(
      api,
      viewerId ? "planning/views" : null,
    ),
    people = usePlanningData<{ items: PlanningPerson[] }>(
      api,
      viewerId
        ? `planning/people?${new URLSearchParams({ ...(filters.project ? { project: filters.project } : {}), limit: "100" })}`
        : null,
    ),
    sprints = usePlanningData<Stored<Sprint>[]>(
      api,
      filters.project
        ? `planning/sprints?project=${encodeURIComponent(filters.project)}`
        : null,
    );
  const [selected, setSelected] = useState(""),
    [dialog, setDialog] = useState<"save" | "copy" | "delete" | null>(null),
    action = usePlanningAction(api, async () => query.reload()),
    current = query.data?.find((v) => v.data.id === selected),
    canEdit =
      !!current &&
      (current.data.ownerId === viewerId ||
        (admin && current.data.visibility === "workspace"));
  const set = (patch: Partial<TaskFilters>) =>
    onApply({ ...filters, ...patch });
  const advancedFilterCount = [
    filters.assigneeUserId,
    filters.priorities?.length,
    filters.sprintId,
    filters.dueAfter,
    filters.dueBefore,
  ].filter(Boolean).length;
  return (
    <div className="saved-views-bar" aria-label="저장한 보기와 공유 필터">
      <div className="planning-toolbar">
        <label>
          저장한 보기
          <select
            aria-label="저장한 보기"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              const view = query.data?.find(
                (v) => v.data.id === e.target.value,
              );
              if (view) onApply(view.data.filters);
            }}
          >
            <option value="">현재 필터</option>
            {query.data?.map((v) => (
              <option key={v.data.id} value={v.data.id}>
                {v.data.name} ·{" "}
                {v.data.visibility === "workspace" ? "공유" : "개인"}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={!viewerId}
          aria-pressed={filters.assigneeUserId === "me"}
          onClick={() =>
            set({
              assigneeUserId:
                filters.assigneeUserId === "me" ? undefined : "me",
              assignee: undefined,
            })
          }
        >
          내 작업
        </button>
        <button
          disabled={
            !canWrite || !viewerId || action.busy || (!!current && !canEdit)
          }
          onClick={() => {
            action.clear();
            setDialog("save");
          }}
        >
          현재 조건 저장
        </button>
        {current && (
          <>
            <button
              disabled={!canWrite || !viewerId || action.busy}
              onClick={() => {
                action.clear();
                setDialog("copy");
              }}
            >
              다른 이름으로 저장
            </button>
            <button
              disabled={!canWrite || !canEdit || action.busy}
              onClick={() => {
                action.clear();
                setDialog("delete");
              }}
            >
              보기 삭제
            </button>
          </>
        )}
      </div>
      <details className="saved-view-filters">
        <summary>
          담당자·일정 필터
          {advancedFilterCount > 0 && <span>{advancedFilterCount}개 적용</span>}
        </summary>
        <div className="planning-toolbar">
          <label>
            담당 계정
            <select
              aria-label="담당 계정 필터"
              value={filters.assigneeUserId ?? ""}
              onChange={(e) =>
                set({
                  assigneeUserId: (e.target.value ||
                    undefined) as TaskFilters["assigneeUserId"],
                  assignee: undefined,
                })
              }
            >
              <option value="">모든 계정</option>
              {viewerId && <option value="me">내 작업</option>}
              <option value="unassigned">계정 미매칭·미지정</option>
              {filters.assigneeUserId &&
                !["me", "unassigned"].includes(filters.assigneeUserId) &&
                !people.data?.items.some(
                  (p) => p.id === filters.assigneeUserId,
                ) && (
                  <option value={filters.assigneeUserId}>
                    저장된 담당 계정
                  </option>
                )}
              {people.data?.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName} · @{p.githubLogin ?? p.login}
                </option>
              ))}
            </select>
          </label>
          <label>
            우선순위
            <select
              aria-label="우선순위 필터"
              value={
                filters.priorities?.length === 1 ? filters.priorities[0] : ""
              }
              onChange={(e) =>
                set({
                  priorities: e.target.value
                    ? [e.target.value as "low" | "medium" | "high"]
                    : undefined,
                })
              }
            >
              <option value="">모든 우선순위</option>
              <option value="high">높음</option>
              <option value="medium">보통</option>
              <option value="low">낮음</option>
            </select>
          </label>
          <label>
            스프린트
            <select
              aria-label="스프린트 필터"
              value={filters.sprintId ?? ""}
              onChange={(e) => set({ sprintId: e.target.value || undefined })}
            >
              <option value="">모든 스프린트</option>
              <option value="backlog">프로젝트 백로그</option>
              {sprints.data?.map((s) => (
                <option key={s.data.id} value={s.data.id}>
                  {s.data.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            마감일 이후
            <input
              aria-label="마감일 이후"
              type="date"
              value={filters.dueAfter ?? ""}
              onChange={(e) => set({ dueAfter: e.target.value || undefined })}
            />
          </label>
          <label>
            마감일 이전
            <input
              aria-label="마감일 이전"
              type="date"
              value={filters.dueBefore ?? ""}
              onChange={(e) => set({ dueBefore: e.target.value || undefined })}
            />
          </label>
        </div>
      </details>
      {(query.error || action.error) && !dialog && (
        <p role="alert" className="alert">
          {action.error || query.error}
        </p>
      )}
      {action.notice && !dialog && (
        <p role="status" className="success-note">
          {action.notice}
        </p>
      )}
      {!viewerId && (
        <small className="muted">
          개인 계정으로 로그인하면 내 작업과 개인·공유 보기를 사용할 수
          있습니다.
        </small>
      )}
      {dialog && (
        <EditorDialog
          title={
            dialog === "delete"
              ? "저장한 보기 삭제"
              : dialog === "copy"
                ? "다른 이름으로 보기 저장"
                : "현재 필터 저장"
          }
          busy={action.busy}
          onClose={() => setDialog(null)}
        >
          {dialog === "delete" ? (
            <>
              <p>
                ‘{current?.data.name}’ 보기를 삭제합니다. 프로젝트와 태스크는
                유지합니다.
              </p>
              {action.error && (
                <p role="alert" className="alert">
                  {action.error}
                </p>
              )}
              <div className="form-actions">
                <button disabled={action.busy} onClick={() => setDialog(null)}>
                  취소
                </button>
                <button
                  className="button danger"
                  disabled={action.busy}
                  onClick={async () => {
                    if (
                      current &&
                      (await action.mutate(
                        "planning/views/delete",
                        { id: current.data.id, revision: current.revision },
                        "보기를 삭제했습니다.",
                      ))
                    ) {
                      setSelected("");
                      setDialog(null);
                    }
                  }}
                >
                  보기 삭제 확인
                </button>
              </div>
            </>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget),
                  id =
                    dialog === "save" && current ? current.data.id : createId();
                if (
                  await action.mutate(
                    "planning/views",
                    {
                      id,
                      name: String(f.get("name")),
                      visibility: f.get("shared") ? "workspace" : "private",
                      filters,
                      revision:
                        dialog === "save" ? (current?.revision ?? 0) : 0,
                    },
                    "보기를 저장했습니다.",
                  )
                ) {
                  setSelected(id);
                  setDialog(null);
                }
              }}
            >
              <label>
                보기 이름
                <input
                  name="name"
                  required
                  maxLength={100}
                  defaultValue={
                    dialog === "copy"
                      ? `${current?.data.name ?? "보기"} 복사`
                      : (current?.data.name ?? "")
                  }
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="shared"
                  defaultChecked={current?.data.visibility === "workspace"}
                />
                워크스페이스 구성원과 공유
              </label>
              <p className="muted">
                ‘내 작업’을 저장하면 보는 사람 자신의 태스크를 표시합니다. 개인
                보기는 본인만 볼 수 있습니다.
              </p>
              {action.error && (
                <p role="alert" className="alert">
                  {action.error}
                </p>
              )}
              <div className="form-actions">
                <button
                  type="button"
                  disabled={action.busy}
                  onClick={() => setDialog(null)}
                >
                  취소
                </button>
                <button className="button" disabled={action.busy}>
                  보기 저장
                </button>
              </div>
            </form>
          )}
        </EditorDialog>
      )}
    </div>
  );
}
