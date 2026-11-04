"use client";
import { useEffect, useState } from "react";
import type { WorkspaceRole } from "../core/model";
export const roleNames: Record<WorkspaceRole, string> = {
  owner: "소유자",
  admin: "관리자",
  member: "멤버",
  viewer: "조회 전용",
};
export default function MemberRoleRow({
  member,
  canManage,
  canPromote,
  busy,
  action,
}: {
  member: {
    id: string;
    login: string;
    display_name: string;
    owner: boolean;
    role: WorkspaceRole;
  };
  canManage: boolean;
  canPromote: boolean;
  busy: boolean;
  action: (path: string, body: unknown) => Promise<void>;
}) {
  const current = member.owner ? "owner" : (member.role ?? "member");
  const [draft, setDraft] = useState(current),
    [removing, setRemoving] = useState(false);
  useEffect(() => {
    setDraft(current);
  }, [current]);
  return (
    <li className="workspace-member-row">
      <span>
        {member.display_name} <small>@{member.login}</small>
      </span>
      <span className="badge">{roleNames[current]}</span>
      {canManage && (
        <div className="member-controls">
          <select
            aria-label={`@${member.login} 역할`}
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value as WorkspaceRole)}
          >
            {canPromote && <option value="admin">관리자</option>}
            <option value="member">멤버</option>
            <option value="viewer">조회 전용</option>
          </select>
          <button
            type="button"
            className="text-button"
            disabled={busy || draft === current}
            onClick={() =>
              void action("members/role", {
                userId: member.id,
                expectedRole: current,
                role: draft,
              })
            }
          >
            역할 저장
          </button>
          <button
            type="button"
            className="text-button danger"
            disabled={busy}
            onClick={() => setRemoving(true)}
          >
            멤버 제외
          </button>
        </div>
      )}
      {removing && (
        <div
          className="member-remove-confirm"
          role="group"
          aria-label={`@${member.login} 제외 확인`}
        >
          <p>
            이 워크스페이스 접근과 해당 공간의 개인 MCP 토큰을 해제합니다. 기존
            작업·댓글은 보존됩니다.
          </p>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => setRemoving(false)}
          >
            취소
          </button>
          <button
            type="button"
            className="button danger"
            disabled={busy}
            onClick={() =>
              void action("members/remove", {
                userId: member.id,
                expectedRole: current,
              })
            }
          >
            제외 확인
          </button>
        </div>
      )}
    </li>
  );
}
