"use client";
import { useState } from "react";
import type { Planning } from "../core/planning";
import {
  usePlanningAction,
  usePlanningData,
  type PlanningApi,
} from "./planning-hooks";
import EditorDialog from "./editor-dialog";
export default function AssigneeMappingPanel({
  api,
  canWrite,
  onRefresh,
}: {
  api: PlanningApi;
  canWrite: boolean;
  onRefresh: () => Promise<void>;
}) {
  const query = usePlanningData<
      Awaited<ReturnType<Planning["assignmentList"]>>
    >(api, "planning/assignments"),
    action = usePlanningAction(api, async () => {
      query.reload();
      await onRefresh();
    }),
    [deleting, setDeleting] = useState<string | null>(null),
    [editing, setEditing] = useState<string | null>(null);
  const row = query.data?.mappings.find((m) => m.data.id === editing),
    remove = query.data?.mappings.find((m) => m.data.id === deleting);
  return (
    <section className="planning-panel" aria-label="담당자 계정 매칭">
      <h2>담당자 계정 매칭</h2>
      <p className="muted">
        검증된 GitHub 아이디 또는 서비스 아이디가 정확히 일치하면 연결됩니다.
        다른 이름으로 가져온 작업은 아래 매칭표로 연결하세요. 표시 이름이
        비슷하다는 이유로 자동 연결하지 않습니다.
      </p>
      {(query.error || action.error) && !deleting && (
        <p role="alert" className="alert">
          {action.error || query.error}
        </p>
      )}
      {action.notice && !deleting && (
        <p role="status" className="success-note">
          {action.notice}
        </p>
      )}
      <div className="planning-grid-scroll">
        <table>
          <thead>
            <tr>
              <th>기존 담당자 이름</th>
              <th>서비스 계정</th>
              <th>GitHub 계정</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {query.data?.mappings.map((m) => {
              const person = query.data?.members.find(
                (u) => u.id === m.data.userId,
              );
              return (
                <tr key={m.data.id}>
                  <td>{m.data.sourceName}</td>
                  <td>{person?.displayName ?? "탈퇴·미등록 계정"}</td>
                  <td>
                    {person?.githubLogin ? `@${person.githubLogin}` : "미연결"}
                  </td>
                  <td>
                    {canWrite && query.data?.canManage && (
                      <>
                        <button
                          className="text-button"
                          onClick={() => {
                            action.clear();
                            setEditing(m.data.id);
                          }}
                        >
                          수정
                        </button>
                        <button
                          className="text-button"
                          onClick={() => {
                            action.clear();
                            setDeleting(m.data.id);
                          }}
                        >
                          삭제
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canWrite && query.data?.canManage && (
        <form
          key={editing ?? "new"}
          className="planning-inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget,
              f = new FormData(form);
            if (
              await action.mutate(
                "planning/assignments",
                {
                  sourceName: String(f.get("sourceName")),
                  userId: String(f.get("userId")),
                  revision: row?.revision ?? 0,
                },
                "담당자 매칭을 저장했습니다.",
              )
            ) {
              setEditing(null);
              form.reset();
            }
          }}
        >
          <label>
            기존 담당자 이름
            <input
              name="sourceName"
              required
              maxLength={100}
              defaultValue={row?.data.sourceName}
              readOnly={!!row}
              placeholder="예: Asana에서 사용한 이름"
            />
          </label>
          <label>
            연결할 계정
            <select
              name="userId"
              aria-label="연결할 계정"
              required
              defaultValue={row?.data.userId ?? ""}
            >
              <option value="" disabled>
                구성원을 선택하세요
              </option>
              {query.data.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} · @{m.githubLogin ?? m.login}
                </option>
              ))}
            </select>
          </label>
          <button className="button" disabled={action.busy}>
            매칭 저장
          </button>
          {editing && (
            <button type="button" onClick={() => setEditing(null)}>
              수정 취소
            </button>
          )}
        </form>
      )}
      <h3>워크스페이스 구성원</h3>
      <ul className="planning-people-list">
        {query.data?.members.map((m) => (
          <li key={m.id}>
            <strong>{m.displayName}</strong> · 서비스 @{m.login} ·{" "}
            {m.githubId
              ? `GitHub @${m.githubLogin} 연결됨`
              : "GitHub 계정 미연결"}
          </li>
        ))}
      </ul>
      {remove && (
        <EditorDialog
          title="담당자 매칭 삭제"
          busy={action.busy}
          onClose={() => setDeleting(null)}
        >
          <p>
            ‘{remove.data.sourceName}’의 명시적 매칭을 삭제합니다. 태스크 자체와
            직접 지정한 담당 계정은 유지합니다.
          </p>
          {action.error && (
            <p role="alert" className="alert">
              {action.error}
            </p>
          )}
          <div className="form-actions">
            <button disabled={action.busy} onClick={() => setDeleting(null)}>
              취소
            </button>
            <button
              className="button danger"
              disabled={action.busy}
              onClick={async () => {
                if (
                  await action.mutate(
                    "planning/assignments/delete",
                    { id: remove.data.id, revision: remove.revision },
                    "매칭을 삭제했습니다.",
                  )
                )
                  setDeleting(null);
              }}
            >
              매칭 삭제
            </button>
          </div>
        </EditorDialog>
      )}
    </section>
  );
}
