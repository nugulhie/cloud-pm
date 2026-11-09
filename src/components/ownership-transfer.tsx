"use client";
import { useState } from "react";
export default function OwnershipTransfer({
  call,
  ownerId,
  members,
  onChanged,
}: {
  call: (path: string, body?: unknown) => Promise<any>;
  ownerId: string;
  members: { id: string; login: string; displayName?: string }[];
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [notice, setNotice] = useState("");
  return (
    <details>
      <summary>워크스페이스 소유자 양도</summary>
      <p className="muted">
        선택한 멤버가 소유자가 되고 현재 소유자는 관리자가 됩니다.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!confirmed || busy) return;
          const f = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await call("workspace/transfer", {
              userId: f.get("userId"),
              expectedOwnerId: ownerId,
              currentPassword: f.get("currentPassword"),
            });
            setNotice("소유자를 양도했습니다.");
            await onChanged();
          } catch (error) {
            setNotice(
              error instanceof Error ? error.message : "소유자 양도 실패",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <label>
            새 소유자
            <select name="userId" required>
              <option value="">멤버 선택</option>
              {members
                .filter((m) => m.id !== ownerId)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName ?? m.login}
                  </option>
                ))}
            </select>
          </label>
          <label>
            현재 비밀번호
            <input
              type="password"
              name="currentPassword"
              autoComplete="current-password"
              placeholder="GitHub 로그인은 비워 두세요"
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            소유자 변경 내용을 확인했습니다.
          </label>
          <button className="button" disabled={!confirmed}>
            소유자 양도 확정
          </button>
        </fieldset>
      </form>
      {notice && <p role="status">{notice}</p>}
    </details>
  );
}
