"use client";
import { useEffect, useRef, useState } from "react";
import type { Users } from "../users/service";
type Listing = Awaited<ReturnType<Users["listWorkspaces"]>>;
export default function WorkspaceSwitcher({
  enabled,
  currentId,
  onChanged,
}: {
  enabled: boolean;
  currentId: string;
  onChanged: (id: string) => Promise<void>;
}) {
  const [listing, setListing] = useState<Listing | null>(null),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  async function call(path: string, body?: unknown) {
    const response = await fetch(`/api/auth/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? "워크스페이스 요청 실패");
    return value;
  }
  async function load() {
    if (!enabled) {
      setListing(null);
      return;
    }
    try {
      setListing(await call("workspaces"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [enabled, currentId]);
  useEffect(() => {
    const element = dialog.current;
    if (open && !element?.open) element?.showModal();
    if (!open && element?.open) element.close();
  }, [open]);
  const current = listing?.workspaces?.find((w) => w.id === currentId);
  async function select(id: string) {
    setBusy(true);
    setError("");
    try {
      await call("workspaces/switch", { id });
      await onChanged(id);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="workspace workspace-switcher-trigger"
        aria-label="워크스페이스 선택 및 생성"
        disabled={!enabled}
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <span className="workspace-icon">
          {current?.name.slice(0, 1) ?? "W"}
        </span>
        <span className="workspace-trigger-text">
          {current?.name ?? "프로젝트 워크스페이스"}
          <small>
            {enabled
              ? "워크스페이스 전환 · 만들기"
              : "로그인 후 생성할 수 있습니다"}
          </small>
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      <dialog
        ref={dialog}
        className="workspace-dialog"
        aria-labelledby="workspace-dialog-title"
        onCancel={(e) => {
          e.preventDefault();
          if (!busy) setOpen(false);
        }}
      >
        <div className="modal-heading">
          <h2 id="workspace-dialog-title">워크스페이스 선택 및 생성</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="닫기"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        <div className="workspace-list">
          {listing?.workspaces?.map((w) => (
            <button
              key={w.id}
              type="button"
              disabled={busy}
              aria-pressed={w.id === currentId}
              onClick={() => void select(w.id)}
            >
              <span>
                <strong>{w.name}</strong>
                <small>
                  {w.description || "프로젝트와 태스크를 관리합니다."}
                </small>
              </span>
              <span className="badge">
                {w.id === currentId
                  ? "사용 중"
                  : w.role === "owner"
                    ? "소유자"
                    : w.role === "admin"
                      ? "관리자"
                      : w.role === "viewer"
                        ? "조회 전용"
                        : "멤버"}
              </span>
            </button>
          ))}
        </div>
        <form
          className="workspace-create-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              const created = await call("workspaces", {
                name: String(f.get("name")),
                description: String(f.get("description") ?? ""),
              });
              await load();
              await call("workspaces/switch", { id: created.id });
              await onChanged(created.id);
              setOpen(false);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3>새 워크스페이스 만들기</h3>
          <p className="section-description">
            같은 GitHub 조직 안에서 별도의 프로젝트와 멤버를 관리합니다. 새
            워크스페이스는 초대받은 멤버만 접근할 수 있습니다.
          </p>
          <label>
            워크스페이스 이름
            <input
              required
              name="name"
              maxLength={100}
              placeholder="예: 플랫폼 개발팀"
            />
          </label>
          <label>
            설명
            <textarea
              name="description"
              maxLength={2000}
              placeholder="이 워크스페이스에서 관리할 업무를 적어주세요."
            />
          </label>
          <button className="button" disabled={busy}>
            {busy ? "처리 중…" : "워크스페이스 생성"}
          </button>
        </form>
      </dialog>
    </>
  );
}
