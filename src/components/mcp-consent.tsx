"use client";
import { useEffect, useState } from "react";
import AccountPanel from "./account-panel";
type Info = {
  request: string;
  csrf: string;
  user: { id: string; name: string };
  client: { name: string; redirectOrigin: string };
  write: boolean;
  workspaces: { id: string; name: string; role: string }[];
};
export default function McpConsent() {
  const [info, setInfo] = useState<Info | null>(null),
    [login, setLogin] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [workspace, setWorkspace] = useState(""),
    [write, setWrite] = useState(false);
  async function load() {
    setError("");
    const id = new URL(window.location.href).searchParams.get("request");
    if (!id) {
      setError("MCP 클라이언트에서 연결 요청을 다시 시작하세요.");
      return;
    }
    try {
      const r = await fetch(
          `/api/auth/mcp/oauth/consent?request=${encodeURIComponent(id)}`,
          { cache: "no-store" },
        ),
        value = await r.json();
      if (r.status === 401) {
        setLogin(true);
        return;
      }
      if (!r.ok)
        throw new Error(
          value.error_description ?? "인증 요청을 확인하지 못했습니다.",
        );
      setLogin(false);
      setInfo(value);
      setWorkspace(value.workspaces[0]?.id ?? "");
    } catch (error) {
      setError(error instanceof Error ? error.message : "인증 요청 실패");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function decide(decision: "allow" | "deny") {
    if (!info || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/auth/mcp/oauth/consent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            request: info.request,
            csrf: info.csrf,
            expectedUserId: info.user.id,
            workspaceId: workspace,
            decision,
            role: write ? "write" : "read",
          }),
        }),
        value = await r.json();
      if (!r.ok)
        throw new Error(
          value.error_description ?? "연결을 승인하지 못했습니다.",
        );
      window.location.assign(value.redirect);
    } catch (error) {
      setError(error instanceof Error ? error.message : "연결 승인 실패");
      setBusy(false);
    }
  }
  return (
    <main className="mcp-consent-page">
      <a className="consent-brand" href="/">
        <img src="/brand/soldoc-logo.svg" alt="솔닥" />
        Cloud PM
      </a>
      <section className="workflow-card">
        <h1>MCP 계정 연결</h1>
        <p>로그인한 계정으로 사용할 워크스페이스와 권한을 확인합니다.</p>
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        {login && (
          <>
            <p>먼저 서비스 계정으로 로그인하세요.</p>
            <AccountPanel
              inDialog
              onChanged={() => {
                void load();
              }}
            />
          </>
        )}
        {info && (
          <>
            <h2>{info.client.name}</h2>
            <p className="muted">
              연결할 클라이언트 주소: {info.client.redirectOrigin}
            </p>
            <p>{info.user.name} 계정으로 연결합니다.</p>
            <label>
              워크스페이스
              <select
                aria-label="MCP 연결 워크스페이스"
                value={workspace}
                onChange={(e) => {
                  setWorkspace(e.target.value);
                  setWrite(false);
                }}
              >
                {info.workspaces.map((w) => (
                  <option value={w.id} key={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <ul>
              <li>
                선택한 워크스페이스에서 현재 계정이 접근할 수 있는 업무를
                조회합니다.
              </li>
              <li>계정이나 저장소 권한이 바뀌면 연결에도 적용됩니다.</li>
            </ul>
            {info.write && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={write}
                  disabled={
                    info.workspaces.find((w) => w.id === workspace)?.role ===
                    "viewer"
                  }
                  onChange={(e) => setWrite(e.target.checked)}
                />
                태스크·PRD·정책 등 업무 데이터 수정도 허용
              </label>
            )}
            <p className="muted">
              프로필의 MCP·API 설정에서 언제든 연결을 해제할 수 있습니다. 계정
              비밀번호와 GitHub 비밀키는 클라이언트에 전달하지 않습니다.
            </p>
            <div className="actions">
              <button
                className="button"
                disabled={busy || !workspace}
                onClick={() => void decide("allow")}
              >
                연결 허용
              </button>
              <button disabled={busy} onClick={() => void decide("deny")}>
                거절
              </button>
            </div>
          </>
        )}
        {!info && !login && !error && (
          <p role="status">연결 요청을 확인하는 중…</p>
        )}
      </section>
    </main>
  );
}
