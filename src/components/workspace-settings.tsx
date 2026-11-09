"use client";
import OwnershipTransfer from "./ownership-transfer";
import MemberRoleRow from "./member-role-row";
import { useEffect, useState, useRef } from "react";
import type { Users } from "../users/service";
type Workspace = Awaited<ReturnType<Users["workspace"]>>;
export default function WorkspaceSettings({
  workspaceId = "main",
  onConnection,
}: {
  workspaceId?: string;
  onConnection?: (connection: Workspace["githubConnection"]) => void;
}) {
  const [data, setData] = useState<Workspace | null>(null),
    [error, setError] = useState(""),
    [issued, setIssued] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  const pending = useRef(false);
  async function call(path: string, body?: unknown) {
    const response = await fetch(`/api/auth/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": workspaceId,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "요청 실패");
    return result;
  }
  async function load() {
    try {
      const workspace = await call("workspace");
      setData(workspace);
      onConnection?.(workspace.githubConnection ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="workspace-settings">
      <h3>워크스페이스 멤버·초대</h3>
      <button
        type="button"
        className="text-button"
        disabled={busy}
        onClick={() => {
          setError("");
          void load();
        }}
      >
        멤버 새로고침
      </button>
      {data?.name && (
        <p className="section-description">
          현재 워크스페이스: <strong>{data.name}</strong>
        </p>
      )}
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <p className="section-description">
            서비스 계정으로 참여하며 GitHub 계정은 필수가 아닙니다. 관리자가
            공유한 GitHub 연결로 저장소 활동을 확인할 수 있습니다.
            워크스페이스를 만든 사람이 소유자가 됩니다. 멤버는 작업을 수정할 수
            있고 조회 전용 사용자는 현황과 댓글을 읽을 수 있습니다. 관리자 역할
            변경은 소유자만 가능합니다.
          </p>
          <ul className="member-list">
            {data.members.map((m) => (
              <MemberRoleRow
                key={m.id}
                member={m}
                busy={busy}
                canPromote={data.role === "owner"}
                canManage={
                  !!data.admin &&
                  !!data.viewerId &&
                  !m.owner &&
                  (data.role === "owner" || m.role !== "admin")
                }
                action={async (path, body) => {
                  if (pending.current) return;
                  pending.current = true;
                  setBusy(true);
                  setError("");
                  try {
                    await call(path, body);
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    pending.current = false;
                    setBusy(false);
                  }
                }}
              />
            ))}
          </ul>
          {data.admin ? (
            <>
              <section className="workspace-github-settings">
                <h4>워크스페이스 GitHub 연결</h4>
                <p className="section-description">
                  {data.githubConnection
                    ? data.githubConnection.kind === "app" &&
                      data.githubConnection.error
                      ? `${data.githubConnection.login} 연결 확인 필요`
                      : `${data.githubConnection.login} 연결 · 저장소 ${data.githubConnection.repositoryCount}개 공유 중`
                    : "공용 GitHub 연결이 없습니다."}{" "}
                  연결된 토큰으로 접근 가능한 저장소를 이 워크스페이스의
                  멤버에게 공유합니다. 수정 권한이 있는 멤버는 이 연결을 통해
                  GitHub 이슈도 생성할 수 있습니다.
                </p>
                {data.githubConnection?.kind === "app" ? (
                  <p className="section-description">
                    조직에 설치한 GitHub App을 사용하며 개인 PAT는 필요하지
                    않습니다. 설치 토큰은 서버에서 자동 갱신합니다.{" "}
                    {data.githubConnection.error && (
                      <span role="alert">{data.githubConnection.error}</span>
                    )}
                  </p>
                ) : (
                  <>
                    <form
                      className="account-form"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const form = event.currentTarget;
                        const githubToken = String(
                          new FormData(form).get("sharedGithubToken") ?? "",
                        );
                        setBusy(true);
                        setError("");
                        try {
                          setData(
                            await call("workspace/github", { githubToken }),
                          );
                          form.reset();
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <label>
                        공용 GitHub 토큰
                        <input
                          name="sharedGithubToken"
                          type="password"
                          required
                          maxLength={1000}
                          autoComplete="off"
                          placeholder="조직 연동용 계정의 토큰"
                        />
                      </label>
                      <button className="button secondary" disabled={busy}>
                        공용 연결 저장
                      </button>
                    </form>
                    <div className="actions">
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          setError("");
                          try {
                            setData(
                              await call("workspace/github", {
                                usePersonal: true,
                              }),
                            );
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        내 개인 GitHub 연결을 워크스페이스에 공유
                      </button>
                      {data.githubConnection && (
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            setError("");
                            try {
                              setData(
                                await call("workspace/github", {
                                  disconnect: true,
                                }),
                              );
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          공용 연결 해제
                        </button>
                      )}
                    </div>
                  </>
                )}
              </section>
              {!data.id || data.id === "main" ? (
                <label className="workspace-policy">
                  <input
                    type="checkbox"
                    checked={data.inviteOnly}
                    disabled={busy}
                    onChange={async (e) => {
                      const inviteOnly = e.target.checked;
                      const previous = data;
                      setData({ ...data, inviteOnly });
                      setBusy(true);
                      setError("");
                      try {
                        setData(await call("workspace", { inviteOnly }));
                      } catch (e) {
                        setData(previous);
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                  초대 링크로만 신규 가입 허용
                </label>
              ) : (
                <p className="section-description">
                  서비스 계정의 참여는 초대 링크로 관리합니다.
                </p>
              )}
              <label className="workspace-policy">
                <input
                  type="checkbox"
                  checked={data.githubOrgJoin ?? false}
                  disabled={busy}
                  onChange={async (e) => {
                    const githubOrgJoin = e.target.checked,
                      previous = data;
                    setData({ ...data, githubOrgJoin });
                    setBusy(true);
                    setError("");
                    try {
                      setData(await call("workspace", { githubOrgJoin }));
                    } catch (e) {
                      setData(previous);
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
                GitHub 조직 구성원의 참여 허용
              </label>
              <p className="section-description">
                허용하면 GitHub로 조직을 확인한 사용자가 이 워크스페이스에
                멤버로 참여하고 조직 공용 연결을 사용할 수 있습니다. 기본
                워크스페이스 외 공간은 처음에는 비공개입니다.
              </p>
              <form
                className="account-form"
                aria-label="워크스페이스 초대"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  setBusy(true);
                  setError("");
                  setIssued("");
                  setCopied(false);
                  try {
                    const login = String(f.get("login") ?? "").trim();
                    const result = await call("invites", {
                      ...(login ? { login } : {}),
                      role: String(f.get("role") ?? "member"),
                    });
                    setIssued(result.url);
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  초대할 서비스 아이디 (선택)
                  <input
                    name="login"
                    maxLength={39}
                    pattern="[A-Za-z0-9-]+"
                    placeholder="입력하면 해당 계정만 사용할 수 있습니다."
                  />
                </label>
                <label>
                  초대 역할
                  <select name="role" defaultValue="member">
                    <option value="member">멤버 (조회·수정)</option>
                    <option value="viewer">조회 전용</option>
                  </select>
                </label>
                <button className="button secondary" disabled={busy}>
                  초대 링크 만들기
                </button>
                <small>
                  7일간 유효한 일회용 링크입니다. 비개발자는 GitHub 없이 가입할
                  수 있습니다.
                </small>
              </form>
              {issued && (
                <div className="issued-token">
                  <label>
                    새 초대 링크
                    <input readOnly value={issued} />
                  </label>
                  <button
                    className="text-button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(issued);
                        setCopied(true);
                      } catch {
                        setError("링크를 선택해 복사하세요.");
                      }
                    }}
                  >
                    {copied ? "복사했습니다" : "링크 복사"}
                  </button>
                  {["localhost", "127.0.0.1"].includes(
                    new URL(issued).hostname,
                  ) && (
                    <p className="section-description">
                      현재 주소는 이 Mac에서만 열립니다. 다른 사람이 접속하려면
                      서버를 배포하고 APP_URL을 공용 HTTPS 주소로 설정해야
                      합니다.
                    </p>
                  )}
                </div>
              )}
              <div className="invite-list">
                {data.invites.map((invite) => {
                  const row = invite as {
                    id: string;
                    expected_login: string | null;
                    status: string;
                    expires_at: string;
                  };
                  const expired =
                    new Date(row.expires_at).getTime() < Date.now();
                  return (
                    <div key={row.id}>
                      <span>
                        {row.expected_login
                          ? `@${row.expected_login}`
                          : "조직 멤버"}
                        <small>
                          만료{" "}
                          {new Date(row.expires_at).toLocaleDateString("ko-KR")}
                        </small>
                      </span>
                      <span className="badge">
                        {row.status === "accepted"
                          ? "가입 완료"
                          : row.status === "revoked"
                            ? "취소"
                            : expired
                              ? "만료"
                              : "초대 대기"}
                      </span>
                      {row.status === "pending" && !expired && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await call("invites/revoke", { id: row.id });
                              await load();
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          초대 취소
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="section-description">
              초대와 멤버 관리는 워크스페이스 소유자·관리자에게 요청하세요.
            </p>
          )}
        </>
      )}
      {data?.viewerId === data?.ownerId && data && (
        <OwnershipTransfer
          call={call}
          ownerId={data.ownerId}
          members={data.members}
          onChanged={load}
        />
      )}
    </section>
  );
}
