"use client";
import SettingsLayout from "./settings-layout";
import McpConnectionPanel from "./mcp-connection-panel";
import WorkspaceSwitcher from "./workspace-switcher";
import WorkspaceSettings from "./workspace-settings";
import { useEffect, useState, type FormEvent } from "react";
import type { Users } from "../users/service";
type Profile = Awaited<ReturnType<Users["profile"]>>;
export default function AccountPanel({
  onChanged,
  inDialog = false,
  inviteToken = "",
  workspaceId = "main",
}: {
  onChanged: (workspaceId?: string | null) => void;
  inDialog?: boolean;
  inviteToken?: string;
  workspaceId?: string;
}) {
  const [profile, setProfile] = useState<Profile | null>(null),
    [register, setRegister] = useState(!!inviteToken),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [issued, setIssued] = useState("");
  const [effectiveWrite, setEffectiveWrite] = useState(true);
  const [workspaceGitHub, setWorkspaceGitHub] =
    useState<Awaited<ReturnType<Users["workspace"]>>["githubConnection"]>(null);
  const [pendingInvite, setPendingInvite] = useState(inviteToken);
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  useEffect(() => {
    setIssued("");
  }, [workspaceId]);
  async function call(path: string, body?: unknown) {
    const r = await fetch(`/api/auth/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": workspaceId,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error ?? "계정 요청에 실패했습니다.");
    return d;
  }
  useEffect(() => {
    setWorkspaceGitHub(null);
    call("me")
      .then((d) => {
        setProfile(d.user);
        setEffectiveWrite(d.effectiveRole !== "read");
      })
      .catch(() => {});
  }, [workspaceId, profile?.id]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await act(async () => {
      const data = register
        ? {
            ...(pendingInvite ? { inviteToken: pendingInvite } : {}),
            password: form.get("password"),
            login: form.get("login"),
            ...(form.get("displayName")
              ? { displayName: form.get("displayName") }
              : {}),
          }
        : { login: form.get("login"), password: form.get("password") };
      const d = await call(register ? "register" : "login", data);
      setProfile(d.user);
      let selectedWorkspace = d.workspaceId ?? null;
      if (pendingInvite) {
        const accepted = await call("invites/accept", { token: pendingInvite });
        selectedWorkspace = accepted.id;
        setPendingInvite("");
        setWorkspaceVersion((v) => v + 1);
      }
      onChanged(selectedWorkspace);
    });
  }
  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      f = new FormData(form);
    await act(async () => {
      const d = await call("profile", {
        displayName: f.get("displayName") ?? profile?.displayName,
        ...(f.get("githubToken") ? { githubToken: f.get("githubToken") } : {}),
      });
      setProfile(d.user);
      const tokenInput = form.elements.namedItem(
        "githubToken",
      ) as HTMLInputElement | null;
      if (tokenInput) tokenInput.value = "";
      setNotice(
        tokenInput
          ? "GitHub 연결 설정을 저장했습니다."
          : "프로필을 저장했습니다.",
      );
      onChanged();
    });
  }
  return (
    <details
      className={`account-panel${inDialog ? " in-dialog" : ""}`}
      open={inDialog || undefined}
    >
      <summary hidden={inDialog}>
        <span className="account-avatar">
          {profile ? profile.displayName.slice(0, 1) : "U"}
        </span>
        <span>
          {profile
            ? `${profile.displayName} · @${profile.login}`
            : "사용자 로그인 / 계정 등록"}
        </span>
        <span className="muted">
          {profile ? "프로필·토큰 설정" : "서비스 계정으로 참여"}
        </span>
      </summary>
      <div className="account-content">
        {pendingInvite && profile && (
          <div className="success-note">
            <p>현재 계정으로 워크스페이스 초대를 수락할 수 있습니다.</p>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const accepted = await call("invites/accept", {
                    token: pendingInvite,
                  });
                  setPendingInvite("");
                  setWorkspaceVersion((v) => v + 1);
                  onChanged(accepted.id);
                })
              }
            >
              워크스페이스 초대 수락
            </button>
          </div>
        )}
        {pendingInvite && !profile && (
          <p className="success-note">
            워크스페이스 초대 링크로 접속했습니다. 서비스 계정으로 가입하세요.
            GitHub 계정은 필요하지 않습니다.
          </p>
        )}
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="success-note" role="status">
            {notice}
          </div>
        )}
        {!profile ? (
          <>
            <div className="body-tabs">
              <button
                type="button"
                aria-pressed={!register}
                onClick={() => {
                  setRegister(false);
                  setError("");
                }}
              >
                로그인
              </button>
              <button
                type="button"
                aria-pressed={register}
                onClick={() => {
                  setRegister(true);
                  setError("");
                }}
              >
                계정 등록
              </button>
            </div>
            <form onSubmit={signIn} className="account-form">
              {register ? (
                <>
                  <p>
                    GitHub 없이 서비스 아이디와 비밀번호로 가입합니다. 초대받은
                    워크스페이스의 프로젝트·PRD·정책·용어집을 관리할 수
                    있습니다.
                  </p>
                  <label>
                    서비스 아이디
                    <input
                      name="login"
                      required
                      minLength={3}
                      maxLength={39}
                      pattern="[A-Za-z0-9-]+"
                      autoComplete="username"
                      placeholder="예: product-manager"
                    />
                  </label>
                  <label>
                    표시 이름
                    <input
                      name="displayName"
                      maxLength={100}
                      autoComplete="nickname"
                    />
                  </label>
                  <small>
                    아이디는 영문·숫자·하이픈 3~39자입니다. GitHub 활동은
                    관리자가 설정한 워크스페이스 공용 연결로 확인합니다.
                  </small>
                </>
              ) : (
                <label>
                  서비스 아이디
                  <input name="login" required autoComplete="username" />
                </label>
              )}
              <label>
                비밀번호
                <input
                  name="password"
                  type="password"
                  minLength={register ? 10 : 1}
                  maxLength={200}
                  required
                  autoComplete={register ? "new-password" : "current-password"}
                />
              </label>
              <button className="button" disabled={busy}>
                {register ? "계정 만들기" : "로그인"}
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="profile-summary">
              <span>@{profile.login}</span>
              <span>
                {workspaceGitHub?.kind === "app"
                  ? workspaceGitHub.error
                    ? "조직 GitHub App 연결 확인 필요"
                    : `조직 GitHub App 연결 · 저장소 ${workspaceGitHub.repositoryCount}개`
                  : workspaceGitHub
                    ? `워크스페이스 GitHub 연결 · 저장소 ${workspaceGitHub.repositoryCount}개`
                    : profile.githubConnected
                      ? `개인 GitHub 연결 · 저장소 ${profile.repositoryCount}개`
                      : "서비스 계정 · GitHub 연결은 워크스페이스에서 관리"}
              </span>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  void act(async () => {
                    await call("logout", {});
                    setProfile(null);
                    setIssued("");
                    onChanged(null);
                  })
                }
              >
                로그아웃
              </button>
            </div>
            <SettingsLayout
              sections={[
                {
                  id: "profile",
                  title: "프로필",
                  description: "이름과 계정 정보를 관리합니다.",
                  content: (
                    <>
                      <form onSubmit={update} className="account-form">
                        <label>
                          표시 이름
                          <input
                            name="displayName"
                            required
                            maxLength={100}
                            defaultValue={profile.displayName}
                          />
                        </label>
                        <button className="button" disabled={busy}>
                          프로필 저장
                        </button>
                      </form>
                    </>
                  ),
                },
                {
                  id: "github",
                  title: "GitHub 연결",
                  description:
                    "개인 GitHub 연결을 관리합니다. 조직 공용 연결을 사용한다면 개인 토큰은 필요하지 않습니다.",
                  content: (
                    <>
                      <form onSubmit={update} className="account-form">
                        <label>
                          개인 GitHub 연결 (선택)
                          <input
                            name="githubToken"
                            type="password"
                            maxLength={1000}
                            placeholder={
                              profile.githubConnected
                                ? `현재 저장됨 · ••••${profile.githubTokenLast4}`
                                : "개발자만 필요할 때 연결하세요"
                            }
                            autoComplete="off"
                          />
                        </label>
                        <small>
                          서비스 이용에 필수인 항목은 아닙니다. 연결 후 교체할
                          때는 같은 GitHub 계정의 토큰을 사용하세요. 비워두면
                          기존 설정을 유지합니다.
                        </small>
                        <button className="button" disabled={busy}>
                          GitHub 연결 저장
                        </button>
                      </form>
                      <p className="section-description">
                        조직 공용 GitHub 연결은 워크스페이스 탭에서 관리합니다.
                      </p>
                    </>
                  ),
                },
                {
                  id: "mcp",
                  title: "MCP·API",
                  description:
                    "Claude 연결에 사용할 개인 토큰과 연결 상태를 관리합니다.",
                  content: (
                    <>
                      <section className="profile-tokens">
                        <h3>개인 MCP·API 접근 토큰</h3>
                        <p>
                          현재 워크스페이스에 고정된 토큰을 발급합니다. 사용자당
                          활성 토큰은 하나이며 새 발급 시 이전 토큰은
                          무효화됩니다.
                        </p>
                        {profile.serviceTokenLast4 &&
                          profile.serviceTokenWorkspaceId !== workspaceId && (
                            <p className="success-note">
                              기존 토큰은 다른 워크스페이스용입니다. 현재
                              워크스페이스를 Claude에 연결하려면 새로
                              발급하세요.
                            </p>
                          )}

                        <p>
                          GitHub 토큰을 외부 클라이언트에 전달하지 않고, 이
                          토큰으로 본인 권한의 MCP를 연결합니다. 실제 권한은
                          현재 워크스페이스 역할에 따라 제한됩니다.
                        </p>
                        <span>
                          {profile.serviceTokenLast4
                            ? `현재 토큰 · ••••${profile.serviceTokenLast4} · ${profile.serviceTokenRole === "read" ? "조회 전용" : "조회·수정"}`
                            : "발급된 토큰 없음"}
                        </span>
                        <div className="picker-actions">
                          {(["read", "write"] as const).map((role) => (
                            <button
                              key={role}
                              type="button"
                              disabled={
                                busy || (role === "write" && !effectiveWrite)
                              }
                              onClick={() =>
                                void act(async () => {
                                  const d = await call("service-token", {
                                    role,
                                  });
                                  setIssued(d.token);
                                  setProfile((await call("me")).user);
                                })
                              }
                            >
                              {role === "read" ? "조회 전용" : "조회·수정"} 토큰
                              발급
                            </button>
                          ))}
                          {profile.serviceTokenLast4 && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void act(async () => {
                                  await call("revoke-service-token", {});
                                  setIssued("");
                                  setProfile((await call("me")).user);
                                })
                              }
                            >
                              토큰 폐기
                            </button>
                          )}
                        </div>
                        {issued && (
                          <div className="issued-token">
                            <label>
                              새 서비스 토큰
                              <input
                                readOnly
                                value={issued}
                                onFocus={(e) => e.target.select()}
                              />
                            </label>
                            <small>
                              새 토큰은 이 화면에서만 확인할 수 있습니다.
                              재발급하면 이전 토큰은 만료됩니다.
                            </small>
                          </div>
                        )}
                      </section>
                      <McpConnectionPanel
                        key={`mcp-${workspaceId}`}
                        workspaceId={workspaceId}
                        issuedToken={issued}
                      />
                    </>
                  ),
                },
                {
                  id: "workspace",
                  title: "워크스페이스",
                  description:
                    "워크스페이스 전환, 멤버 초대와 공용 GitHub 연결을 관리합니다.",
                  content: (
                    <>
                      <div className="profile-workspace-switcher">
                        <WorkspaceSwitcher
                          enabled={!!profile && !busy}
                          currentId={workspaceId}
                          onChanged={async (id) => onChanged(id)}
                        />
                      </div>
                      <WorkspaceSettings
                        key={`${workspaceId}-${workspaceVersion}`}
                        workspaceId={workspaceId}
                        onConnection={setWorkspaceGitHub}
                      />
                    </>
                  ),
                },
                {
                  id: "security",
                  title: "보안",
                  description: "비밀번호와 로그인 보안을 관리합니다.",
                  content: (
                    <>
                      <section className="password-settings">
                        <h4>비밀번호 변경</h4>
                        <form
                          className="account-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            void act(async () => {
                              await call("password", {
                                currentPassword: f.get("currentPassword"),
                                newPassword: f.get("newPassword"),
                              });
                              setNotice(
                                "비밀번호를 변경하고 다른 로그인 세션을 종료했습니다.",
                              );
                            });
                          }}
                        >
                          <label>
                            현재 비밀번호
                            <input
                              name="currentPassword"
                              type="password"
                              required
                              autoComplete="current-password"
                            />
                          </label>
                          <label>
                            새 비밀번호
                            <input
                              name="newPassword"
                              type="password"
                              required
                              minLength={10}
                              maxLength={200}
                              autoComplete="new-password"
                            />
                          </label>
                          <button className="button secondary" disabled={busy}>
                            비밀번호 변경
                          </button>
                        </form>
                      </section>
                    </>
                  ),
                },
              ]}
            />
          </>
        )}
      </div>
    </details>
  );
}
