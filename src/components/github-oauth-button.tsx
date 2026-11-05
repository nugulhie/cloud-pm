"use client";
import { useEffect, useState } from "react";
export default function GitHubOAuthButton({
  link = false,
  connected = false,
  login,
}: {
  link?: boolean;
  connected?: boolean;
  login?: string | null;
}) {
  const [config, setConfig] = useState<{
    enabled: boolean;
    organization: string;
    callbackUrl: string | null;
  } | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/auth/github/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (active) setConfig(v);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return (
    <div className="github-oauth-connect">
      {connected ? (
        <p className="success-note">GitHub 계정 연결됨 · @{login}</p>
      ) : (
        <a
          className={`button secondary${!config?.enabled ? " disabled" : ""}`}
          href={
            config?.enabled
              ? `/api/auth/github/start?intent=${link ? "link" : "signin"}`
              : undefined
          }
          aria-disabled={!config?.enabled}
        >
          {link ? "내 GitHub 계정 연결" : "GitHub으로 가입·로그인"}
        </a>
      )}
      {!connected && config && !config.enabled && (
        <small className="section-description">
          GitHub 로그인 설정을 준비 중입니다. 서비스 아이디로 이용할 수
          있습니다.
        </small>
      )}
      {!connected && config?.enabled && (
        <small className="section-description">
          {config.organization} 조직의 활성 구성원 계정을 확인합니다.
          {link ? " 현재 서비스 계정에 연결됩니다." : ""}
        </small>
      )}
    </div>
  );
}
