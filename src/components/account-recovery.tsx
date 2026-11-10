"use client";
import { useEffect, useState } from "react";
export default function AccountRecovery({
  call,
  admin = false,
}: {
  call: (path: string, body?: unknown) => Promise<any>;
  admin?: boolean;
}) {
  const [users, setUsers] = useState<
      { id: string; login: string; display_name: string }[]
    >([]),
    [token, setToken] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [optionsError, setOptionsError] = useState(""),
    [loadingOptions, setLoadingOptions] = useState(false);
  async function loadOptions() {
    setOptionsError("");
    setLoadingOptions(true);
    try {
      const result = await call("recovery/options");
      if (
        !Array.isArray(result?.users) ||
        !result.users.every((user: unknown) => {
          if (!user || typeof user !== "object") return false;
          const row = user as Record<string, unknown>;
          return (
            typeof row.id === "string" &&
            typeof row.login === "string" &&
            typeof row.display_name === "string"
          );
        })
      )
        throw new Error("복구 계정 목록 응답을 확인하지 못했습니다.");
      setUsers(result.users);
    } catch (error) {
      setOptionsError(
        error instanceof Error ? error.message : "복구 계정 목록 조회 실패",
      );
    } finally {
      setLoadingOptions(false);
    }
  }
  useEffect(() => {
    if (admin) void loadOptions();
  }, [admin]);
  return (
    <details className="account-recovery">
      <summary>
        {admin ? "다른 계정의 비밀번호 복구" : "비밀번호를 잊으셨나요?"}
      </summary>
      <p className="muted">
        {admin
          ? "서비스 소유자가 본인 확인을 마친 사용자에게 30분 동안 한 번 사용할 복구 코드를 발급합니다. 코드는 별도 경로로 직접 전달하세요."
          : "서비스 소유자에게 본인 확인을 받은 뒤 복구 코드를 받아 입력하세요. 복구 후 기존 로그인과 개인 MCP 토큰은 해제됩니다."}
      </p>
      {admin && loadingOptions && (
        <p role="status">복구할 계정을 불러오는 중…</p>
      )}
      {admin && optionsError && (
        <div role="alert">
          <p>{optionsError}</p>
          <button
            type="button"
            disabled={loadingOptions}
            onClick={() => void loadOptions()}
          >
            복구 계정 다시 불러오기
          </button>
        </div>
      )}
      {admin && !users.length ? (
        !optionsError &&
        !loadingOptions && (
          <p>
            복구 코드 발급은 서비스 소유자가 비밀번호 계정에 대해 사용할 수
            있습니다. GitHub 계정은 GitHub에서 복구하세요.
          </p>
        )
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const element = e.currentTarget,
              f = new FormData(element);
            setBusy(true);
            setNotice("");
            setToken("");
            try {
              const result = await call(
                admin ? "recovery/issue" : "recovery/reset",
                admin
                  ? {
                      userId: f.get("userId"),
                      currentPassword: f.get("currentPassword"),
                    }
                  : {
                      token: f.get("token"),
                      newPassword: f.get("newPassword"),
                    },
              );
              if (admin) {
                if (
                  typeof result?.token !== "string" ||
                  result.token.length < 40 ||
                  result.token.length > 100
                )
                  throw new Error(
                    "복구 코드 응답을 확인하지 못했습니다. 다시 발급하세요.",
                  );
                setToken(result.token);
                setNotice(
                  "복구 코드를 발급했습니다. 이 화면에서만 확인할 수 있습니다.",
                );
              } else {
                setNotice(
                  "비밀번호를 재설정했습니다. 새 비밀번호로 로그인하세요.",
                );
                element.reset();
              }
            } catch (error) {
              setNotice(
                error instanceof Error
                  ? error.message
                  : "복구 요청에 실패했습니다.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy}>
            {admin ? (
              <>
                <label>
                  복구할 계정
                  <select name="userId" required>
                    {users.map((u) => (
                      <option value={u.id} key={u.id}>
                        {u.display_name} · {u.login}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  소유자 현재 비밀번호
                  <input
                    name="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    placeholder="GitHub 로그인 계정은 비워 두세요"
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  일회성 복구 코드
                  <input
                    name="token"
                    type="password"
                    required
                    autoComplete="off"
                    minLength={40}
                    maxLength={100}
                  />
                </label>
                <label>
                  새 비밀번호
                  <input
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={10}
                    maxLength={200}
                  />
                </label>
              </>
            )}
            <button className="button">
              {busy ? "처리 중…" : admin ? "복구 코드 발급" : "비밀번호 재설정"}
            </button>
          </fieldset>
        </form>
      )}
      {token && (
        <label>
          발급한 복구 코드
          <input
            type="text"
            readOnly
            value={token}
            autoComplete="off"
            onFocus={(e) => e.target.select()}
          />
        </label>
      )}
      {notice && <p role="status">{notice}</p>}
    </details>
  );
}
