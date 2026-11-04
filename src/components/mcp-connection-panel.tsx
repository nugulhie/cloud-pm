"use client";
import { useEffect, useRef, useState } from "react";
import type { Users } from "../users/service";
type Status = Awaited<ReturnType<Users["mcpStatus"]>>;
export default function McpConnectionPanel({
  workspaceId,
  issuedToken,
}: {
  workspaceId: string;
  issuedToken: string;
}) {
  const [status, setStatus] = useState<Status | null>(null),
    [token, setToken] = useState(issuedToken);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState(""),
    [copied, setCopied] = useState(false);
  const alive = useRef(true),
    pending = useRef(false);
  async function load() {
    const response = await fetch("/api/auth/mcp/status", {
      headers: { "X-Workspace-Id": workspaceId },
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error ?? "연결 설정을 불러오지 못했습니다.");
    if (
      !data.workspace ||
      typeof data.workspace.name !== "string" ||
      !data.token
    )
      throw new Error("MCP 연결 설정 응답을 확인하지 못했습니다.");
    if (alive.current) setStatus(data);
  }
  useEffect(() => {
    alive.current = true;
    void load().catch((e) => {
      if (alive.current) setError(e.message);
    });
    return () => {
      alive.current = false;
    };
  }, [workspaceId]);
  useEffect(() => {
    setToken(issuedToken);
    setResult("");
    void load().catch(() => {});
  }, [issuedToken]);
  async function check() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setResult("");
    try {
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token.trim()}`,
        "X-Workspace-Id": workspaceId,
      };
      const initial = await fetch("/api/mcp", {
        method: "POST",
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "cloud-pm-connection-check", version: "1" },
          },
        }),
      });
      const handshake = await initial.json();
      if (!initial.ok || handshake.error || !handshake.result?.protocolVersion)
        throw new Error(
          `인증·초기화에 실패했습니다 (${initial.status}). 토큰과 워크스페이스를 확인하세요.`,
        );
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: {
          ...headers,
          "MCP-Protocol-Version": handshake.result.protocolVersion,
        },
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }),
      });
      const data = await response.json();
      if (!response.ok || data.error || !Array.isArray(data.result?.tools))
        throw new Error("MCP 도구 목록을 읽지 못했습니다.");
      const writable = data.result.tools.some(
        (tool: { name: string }) => tool.name === "create_task",
      );
      if (alive.current)
        setResult(
          `서버 인증·도구 조회 성공 · ${data.result.tools.length}개 도구 · ${writable ? "조회·수정 지원" : "조회 전용"}. 외부 Claude 연결은 별도 확인이 필요합니다.`,
        );
      await load();
    } catch {
      if (alive.current)
        setError(
          "연결 점검에 실패했습니다. 현재 공간용 개인 토큰과 접근 권한을 확인하세요.",
        );
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="mcp-connection-panel" aria-label="Claude MCP 연결">
      <div className="discussion-heading">
        <h3>Claude MCP 연결</h3>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            setError("");
            void load().catch((e) => setError(e.message));
          }}
        >
          연결 정보 새로고침
        </button>
      </div>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {status && (
        <>
          <p className="section-description">
            현재 공간: <strong>{status.workspace.name}</strong> ·{" "}
            {status.effectiveRole === "write" ? "조회·수정" : "조회 전용"}
          </p>
          <p
            className={
              status.publicHttps ? "success-note" : "section-description"
            }
          >
            {status.publicHttps
              ? "공개 HTTPS 주소 형식이 설정되었습니다. 외부 접근 가능 여부는 배포 후 확인하세요."
              : "로컬 연결은 점검할 수 있습니다. Claude Chat에는 공개 HTTPS 주소가 필요합니다."}
          </p>
          <label>
            MCP 연결 주소
            <input readOnly value={status.url ?? "APP_URL 설정 필요"} />
          </label>
          <button
            type="button"
            className="text-button"
            disabled={!status.url}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(status.url!);
                setCopied(true);
              } catch {
                setError("연결 주소를 선택해 복사하세요.");
              }
            }}
          >
            {copied ? "주소를 복사했습니다" : "연결 주소 복사"}
          </button>
          {!status.token.exists ? (
            <p className="section-description">
              위에서 개인 MCP 토큰을 발급하세요.
            </p>
          ) : (
            !status.token.currentWorkspace && (
              <p className="section-description">
                저장된 토큰은 다른 공간용입니다. 현재 공간용 토큰을 발급하세요.
              </p>
            )
          )}
          <details>
            <summary>Claude 연결 방법</summary>
            <ol>
              <li>
                Claude의 Customize → Connectors → Add custom connector에서 위
                주소를 등록합니다.
              </li>
              <li>
                Request headers에 <code>Authorization</code>과{" "}
                <code>Bearer &lt;개인 MCP 토큰&gt;</code>을 입력합니다. 현재
                인증 방식은 고정 토큰입니다.
              </li>
              <li>
                대화의 Connectors에서 활성화한 뒤 “프로젝트 현황을 조회해 줘”로
                확인합니다.
              </li>
            </ol>
            <p className="section-description">
              팀 공용 자격 증명은 사용자가 공유합니다. 개인별 연결에는 각자의
              토큰을 사용하세요.
            </p>
            <a
              href="https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp"
              target="_blank"
              rel="noreferrer"
            >
              Claude 공식 연결 안내
            </a>
          </details>
          <form
            className="account-form"
            onSubmit={(e) => {
              e.preventDefault();
              void check();
            }}
          >
            <label>
              점검할 개인 MCP 토큰
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  setResult("");
                }}
                placeholder="기존 토큰을 입력하거나 위에서 새로 발급하세요."
                required
              />
            </label>
            <small>
              현재 화면에서만 사용하며 저장하지 않습니다. 점검은 인증·도구
              목록만 읽습니다.
            </small>
            <button
              className="button secondary"
              disabled={busy || !token.trim()}
            >
              {busy ? "점검 중…" : "MCP 연결 점검"}
            </button>
          </form>
          {result && (
            <p role="status" className="success-note">
              {result}
            </p>
          )}
          <div className="mcp-last-connection">
            <strong>현재 토큰의 최근 MCP 요청</strong>
            <p>
              {status.lastConnection
                ? `${new Date(status.lastConnection.at).toLocaleString("ko-KR")} · ${status.lastConnection.client ?? "클라이언트 정보 없음"} · ${status.lastConnection.method}`
                : "아직 확인된 요청이 없습니다."}
            </p>
            <small>
              위 자체 점검도 요청으로 기록됩니다. 이 기록만으로 Claude 연결
              완료를 의미하지 않습니다.
            </small>
          </div>
        </>
      )}
    </section>
  );
}
