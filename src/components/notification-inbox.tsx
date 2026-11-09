"use client";
import { useEffect, useRef, useState } from "react";
import type { Service } from "../core/service";
type Inbox = Awaited<ReturnType<Service["listNotifications"]>>;
export default function NotificationInbox({
  api,
  onOpen,
}: {
  api: (path: string, body?: unknown) => Promise<any>;
  onOpen: (task: string, destination?: string) => void;
}) {
  const request = useRef(api);
  request.current = api;
  const [inbox, setInbox] = useState<Inbox>({ notifications: [], unread: 0 });
  const [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const active = useRef(true),
    pending = useRef(false),
    dialog = useRef<HTMLDialogElement>(null);
  async function load() {
    const result = await request.current("notifications");
    if (active.current) setInbox(result);
  }
  useEffect(() => {
    active.current = true;
    void load().catch(() => {});
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !pending.current)
        void load().catch(() => {});
    }, 30000);
    return () => {
      active.current = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (e) {
      if (active.current)
        setError(e instanceof Error ? e.message : "알림 처리에 실패했습니다.");
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="button secondary notification-trigger"
        aria-label={`알림함, 미읽음 ${inbox.unread}개`}
        onClick={() => {
          setOpen(true);
          void run(async () => {});
        }}
      >
        알림
        {inbox.unread > 0 && (
          <span className="notification-count">{inbox.unread}</span>
        )}
      </button>
      <dialog
        ref={dialog}
        className="notification-dialog"
        aria-label="개인 알림함"
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
      >
        <div className="discussion-heading">
          <h2>알림함</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="알림함 닫기"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>
        <p className="section-description">
          현재 워크스페이스의 댓글·멘션·업무 알림입니다. 30초마다 갱신합니다.
        </p>
        <div className="comment-actions">
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void run(async () => {})}
          >
            알림 새로고침
          </button>
          <button
            className="text-button"
            disabled={busy || !inbox.unread}
            onClick={() =>
              void run(async () => {
                await Promise.all(
                  inbox.notifications
                    .filter((n) => !n.read)
                    .map((n) =>
                      request.current("notifications/read", {
                        id: n.id,
                        revision: n.revision,
                      }),
                    ),
                );
              })
            }
          >
            모두 읽음
          </button>
        </div>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        {!inbox.notifications.length && (
          <p className="empty">받은 알림이 없습니다.</p>
        )}
        <ol className="notification-list">
          {inbox.notifications.map((n) => (
            <li key={n.id}>
              <button
                className={`notification-item${n.read ? "" : " unread"}`}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await request.current("notifications/read", {
                      id: n.id,
                      revision: n.revision,
                    });
                    if (active.current) {
                      setOpen(false);
                      onOpen(n.task, n.destination);
                    }
                  })
                }
              >
                <strong>
                  {!n.read && <span className="live-dot" />} {n.title}
                </strong>
                <span>{n.author}</span>
                <p>{n.body.slice(0, 160)}</p>
                <time dateTime={n.updatedAt}>
                  {new Date(n.updatedAt).toLocaleString("ko-KR")}
                </time>
              </button>
            </li>
          ))}
        </ol>
      </dialog>
    </>
  );
}
