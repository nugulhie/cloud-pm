"use client";
import { useEffect, useState } from "react";
export default function OAuthConnections() {
  const [items, setItems] = useState<
      {
        id: string;
        client: string;
        workspace_id: string;
        role: string;
        created_at: string;
        last_used_at: string | null;
      }[]
    >([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      const r = await fetch("/api/auth/mcp/oauth/connections", {
          cache: "no-store",
        }),
        value = await r.json();
      if (!r.ok) throw new Error(value.error_description ?? "연결 조회 실패");
      setItems(value.items);
    } catch (error) {
      setError(error instanceof Error ? error.message : "연결 조회 실패");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="oauth-connections">
      <h3>계정 인증으로 연결한 MCP</h3>
      <p className="muted">
        OAuth를 지원하는 MCP 클라이언트에는 이 서비스의 <code>/api/mcp</code>{" "}
        주소를 등록하고 계정 인증을 선택할 수 있습니다.
      </p>
      {error && <p role="alert">{error}</p>}
      {!items.length && (
        <p className="muted">계정 인증으로 연결한 클라이언트가 없습니다.</p>
      )}
      {items.map((item) => (
        <div className="trash-row" key={item.id}>
          <div>
            <strong>{item.client}</strong>
            <p>
              {item.workspace_id} ·{" "}
              {item.role === "write" ? "조회·수정" : "조회"} · 최근 사용{" "}
              {item.last_used_at
                ? new Date(item.last_used_at).toLocaleString("ko-KR")
                : "없음"}
            </p>
          </div>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await fetch("/api/auth/mcp/oauth/disconnect", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ id: item.id }),
                });
                if (!r.ok) throw new Error("연결 해제 실패");
                await load();
              } catch (error) {
                setError(
                  error instanceof Error ? error.message : "연결 해제 실패",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            연결 해제
          </button>
        </div>
      ))}
    </section>
  );
}
