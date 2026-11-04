"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Service } from "../core/service";
import MarkdownBody from "./markdown-body";
type Thread = Awaited<ReturnType<Service["listComments"]>>;
type Comment = Thread["comments"][number];
export default function TaskDiscussion({
  task,
  repository,
  writable,
  api,
}: {
  task: string;
  repository: string;
  writable: boolean;
  api: (path: string, body?: unknown) => Promise<any>;
}) {
  const request = useRef(api);
  request.current = api;
  const alive = useRef(true);
  const [thread, setThread] = useState<Thread | null>(null);
  const [body, setBody] = useState(""),
    [editing, setEditing] = useState<Comment | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submitting = useRef(false);
  async function load() {
    const result = await request.current(
      `comments?task=${encodeURIComponent(task)}`,
    );
    if (alive.current) setThread(result);
  }
  useEffect(() => {
    alive.current = true;
    void load().catch((e) => {
      if (alive.current) setError(e.message);
    });
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !submitting.current)
        void load().catch(() => {});
    }, 30000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [task]);
  async function run(action: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "댓글 처리에 실패했습니다.");
    } finally {
      submitting.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await request.current("comments", {
        task,
        body,
        ...(editing ? { id: editing.data.id, revision: editing.revision } : {}),
      });
      if (alive.current) {
        setBody("");
        setEditing(null);
      }
    });
  }
  return (
    <section className="task-discussion" aria-label="태스크 댓글">
      <div className="discussion-heading">
        <h3>댓글 {thread ? `(${thread.comments.length})` : ""}</h3>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => void run(async () => {})}
        >
          댓글 새로고침
        </button>
      </div>
      <p className="section-description">
        Markdown으로 대화하고 @서비스아이디로 구성원을 호출하세요. 담당자와 기존
        대화 참여자에게도 앱 내 알림을 보냅니다.
      </p>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {!thread ? (
        <p>댓글을 불러오는 중…</p>
      ) : !thread.comments.length ? (
        <p className="empty small">첫 댓글을 작성해 보세요.</p>
      ) : (
        <ol className="comment-list">
          {thread.comments.map((comment) => (
            <li key={comment.data.id} className="comment-item">
              <div className="comment-meta">
                <strong>@{comment.data.author}</strong>
                <time dateTime={comment.data.createdAt}>
                  {new Date(comment.data.createdAt).toLocaleString("ko-KR")}
                </time>
                {comment.revision > 1 && <small>수정됨</small>}
              </div>
              <MarkdownBody body={comment.data.body} repository={repository} />
              {writable && thread.viewerId === comment.data.authorId && (
                <div className="comment-actions">
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setEditing(comment);
                      setBody(comment.data.body);
                      setDeleting(null);
                    }}
                  >
                    댓글 수정
                  </button>
                  <button
                    type="button"
                    className="text-button danger"
                    disabled={busy}
                    onClick={() => setDeleting(comment.data.id)}
                  >
                    댓글 삭제
                  </button>
                </div>
              )}
              {deleting === comment.data.id && (
                <div
                  className="comment-delete"
                  role="group"
                  aria-label="댓글 삭제 확인"
                >
                  <span>이 댓글을 삭제할까요?</span>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setDeleting(null)}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className="button danger"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await request.current("comments/delete", {
                          id: comment.data.id,
                          revision: comment.revision,
                        });
                        setDeleting(null);
                        if (editing?.data.id === comment.data.id) {
                          setEditing(null);
                          setBody("");
                        }
                      })
                    }
                  >
                    삭제 확인
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {writable && thread?.viewerId ? (
        <form onSubmit={submit} className="comment-form">
          <label>
            {editing ? "댓글 수정 내용" : "새 댓글"}
            <textarea
              aria-label={editing ? "댓글 수정 내용" : "새 댓글"}
              value={body}
              maxLength={8000}
              required
              rows={4}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          {!!thread.members.length && (
            <div
              className="mention-choices"
              role="group"
              aria-label="멘션할 구성원"
            >
              {thread.members.map((member) => (
                <button
                  type="button"
                  className="text-button"
                  key={member.login}
                  disabled={busy}
                  onClick={() =>
                    setBody(
                      (value) =>
                        `${value}${value && !/\s$/.test(value) ? " " : ""}@${member.login} `,
                    )
                  }
                >
                  @{member.login}
                </button>
              ))}
            </div>
          )}
          <div className="form-actions">
            {editing && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                  setBody("");
                }}
              >
                수정 취소
              </button>
            )}
            <button className="button" disabled={busy || !body.trim()}>
              {busy ? "처리 중…" : editing ? "댓글 수정 저장" : "댓글 등록"}
            </button>
          </div>
        </form>
      ) : (
        <p className="section-description">
          댓글 작성에는 수정 권한이 있는 개인 계정이 필요합니다.
        </p>
      )}
    </section>
  );
}
