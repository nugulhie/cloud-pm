import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { Store } from "../src/db/store";
import { Users } from "../src/users/service";
import { GitHubOAuth } from "../src/users/github-oauth";
import { Workspaces } from "../src/workspaces/service";
import { DomainError } from "../src/core/model";
import { encryptToken } from "../src/users/crypto";

test("GitHub OAuth의 PKCE·일회용 상태·기존 계정 소유권·조직 참여", async (t) => {
  const names = [
    "APP_URL",
    "GITHUB_ORG",
    "GITHUB_OAUTH_CLIENT_ID",
    "GITHUB_OAUTH_CLIENT_SECRET",
    "TOKEN_ENCRYPTION_KEY",
    "DEMO_MODE",
  ];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, {
    APP_URL: "https://pm.example.test",
    GITHUB_ORG: "org",
    GITHUB_OAUTH_CLIENT_ID: "synthetic-client",
    GITHUB_OAUTH_CLIENT_SECRET: "synthetic-secret",
    TOKEN_ENCRYPTION_KEY: "ab".repeat(32),
    DEMO_MODE: "false",
  });
  const store = new Store();
  let id = 11,
    login = "developer",
    membership = "active",
    exchanges = 0,
    challenge = "";
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://github.com/login/oauth/access_token") {
      exchanges++;
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("client_id"), "synthetic-client");
      assert.equal(body.get("client_secret"), "synthetic-secret");
      assert.equal(
        createHash("sha256")
          .update(body.get("code_verifier")!)
          .digest("base64url"),
        challenge,
      );
      assert.equal(
        body.get("redirect_uri"),
        "https://pm.example.test/api/auth/github/callback",
      );
      return Response.json({
        access_token: "synthetic-user-token",
        token_type: "bearer",
      });
    }
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer synthetic-user-token",
    );
    if (url === "https://api.github.com/user")
      return Response.json({ id, login, name: "개발자", type: "User" });
    if (url === "https://api.github.com/user/memberships/orgs/org")
      return Response.json({ state: membership, role: "member" });
    throw new Error("Unexpected mock path");
  };
  const users = new Users(store, fetcher),
    oauth = new GitHubOAuth(store, fetcher);
  const start = async (intent = "signin", session?: string) => {
    const request = new Request(
      `https://pm.example.test/api/auth/github/start?intent=${intent}`,
      { headers: session ? { cookie: `pm_session=${session}` } : {} },
    );
    const result = await oauth.start(request),
      url = new URL(result.url);
    challenge = url.searchParams.get("code_challenge")!;
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.has("client_secret"), false);
    return {
      state: url.searchParams.get("state")!,
      browser: result.cookie.split(";")[0]!,
      session,
    };
  };
  const callback = (
    state: { state: string; browser: string; session?: string },
    override?: { browser?: string; session?: string },
  ) =>
    new Request(
      `https://pm.example.test/api/auth/github/callback?state=${state.state}&code=synthetic-code`,
      {
        headers: {
          cookie: `${override?.browser ?? state.browser}${(override?.session ?? state.session) ? `; pm_session=${override?.session ?? state.session}` : ""}`,
        },
      },
    );
  let local: Awaited<ReturnType<Users["register"]>>,
    oauthSession: Awaited<ReturnType<GitHubOAuth["callback"]>>;
  try {
    local = await users.register({
      login: "developer",
      password: "synthetic-long-password",
      displayName: "기존 PM",
    });
    await t.test(
      "공개 설정은 시크릿을 반환하지 않고 필수 설정 누락 시 인증을 열지 않는다",
      async () => {
        assert.equal(oauth.publicConfig().enabled, true);
        assert.equal("secret" in oauth.publicConfig(), false);
        delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
        assert.equal(oauth.publicConfig().enabled, false);
        await assert.rejects(
          oauth.start(
            new Request("https://pm.example.test/api/auth/github/start"),
          ),
          (e) => e instanceof DomainError && e.status === 503,
        );
        process.env.GITHUB_OAUTH_CLIENT_SECRET = "synthetic-secret";
      },
    );
    await t.test(
      "브라우저 변조는 원격 교환 전에 막고 로그인 이름 일치로 기존 계정을 가져가지 않는다",
      async () => {
        const state = await start(),
          before = exchanges;
        await assert.rejects(
          oauth.callback(
            callback(state, { browser: "pm_github_oauth=" + "a".repeat(43) }),
          ),
          (e) => e instanceof DomainError && e.status === 409,
        );
        assert.equal(exchanges, before);
        oauthSession = await oauth.callback(callback(state));
        assert.notEqual(oauthSession.session.user.id, local.user.id);
        assert.equal(oauthSession.session.user.login, "gh-11");
        assert.equal(oauthSession.session.user.githubId, "11");
        assert.equal(oauthSession.session.user.authProvider, "github");
        const user = (
          await store.query<{
            github_cipher: string;
            github_id: string | null;
          }>("SELECT github_cipher,github_id FROM app_users WHERE id=$1", [
            oauthSession.session.user.id,
          ])
        )[0]!;
        assert.equal(user.github_cipher, "");
        assert.equal(
          (
            await store.query<{ github_id: string | null }>(
              "SELECT github_id FROM app_users WHERE id=$1",
              [local.user.id],
            )
          )[0]!.github_id,
          null,
        );
        await assert.rejects(
          oauth.callback(callback(state)),
          (e) => e instanceof DomainError && e.status === 409,
        );
        assert.equal(exchanges, before + 1);
      },
    );
    await t.test(
      "GitHub login 변경 후에도 숫자 ID로 같은 서비스 계정을 찾는다",
      async () => {
        login = "renamed-developer";
        const result = await oauth.callback(callback(await start()));
        assert.equal(result.session.user.id, oauthSession.session.user.id);
        assert.equal(result.session.user.githubLogin, login.toLowerCase());
        oauthSession = result;
      },
    );
    await t.test(
      "기존 계정 연결은 동일 브라우저 세션을 요구하고 다른 계정의 GitHub ID 연결은 거절한다",
      async () => {
        const state = await start("link", local.token),
          before = exchanges;
        await assert.rejects(
          oauth.callback(callback(state, { session: "different-session" })),
          (e) => e instanceof DomainError && e.status === 401,
        );
        assert.equal(exchanges, before);
        await assert.rejects(
          oauth.callback(callback(await start("link", local.token))),
          (e) => e instanceof DomainError && e.status === 409,
        );
        id = 12;
        login = "pm-developer";
        const linked = await oauth.callback(
          callback(await start("link", local.token)),
        );
        assert.equal(linked.session.user.id, local.user.id);
        assert.equal(linked.session.user.authProvider, "password");
        assert.equal(linked.session.user.githubId, "12");
        const signedIn = await users.login({
          login: "developer",
          password: "synthetic-long-password",
        });
        assert.equal(signedIn.user.id, local.user.id);
      },
    );
    await t.test(
      "개인 PAT 해제는 브라우저 본인만 수행하고 검증된 GitHub 계정은 보존한다",
      async () => {
        await store.query(
          "UPDATE app_users SET github_cipher=$2,github_last4='test' WHERE id=$1",
          [local.user.id, encryptToken("synthetic-personal-token")],
        );
        await assert.rejects(
          users.disconnectPersonalGitHub(
            new Request(
              "https://pm.example.test/api/auth/github/disconnect-token",
              { headers: { authorization: "Bearer synthetic-service-token" } },
            ),
          ),
          (e) => e instanceof DomainError && e.status === 403,
        );
        const result = await users.disconnectPersonalGitHub(
          new Request(
            "https://pm.example.test/api/auth/github/disconnect-token",
            { headers: { cookie: `pm_session=${local.token}` } },
          ),
        );
        assert.equal(result.githubConnected, false);
        assert.equal(result.githubOAuthConnected, true);
        assert.equal(result.githubId, "12");
        assert.equal(result.githubLogin, "pm-developer");
      },
    );
    await t.test(
      "만료·취소·대기 중 조직 멤버십에서는 새 계정을 생성하지 않는다",
      async () => {
        const expired = await start();
        await store.query(
          "UPDATE github_oauth_states SET expires_at=now()-interval '1 minute' WHERE state_hash=$1",
          [createHash("sha256").update(expired.state).digest("hex")],
        );
        await assert.rejects(
          oauth.callback(callback(expired)),
          (e) => e instanceof DomainError && e.status === 409,
        );
        id = 13;
        login = "pending-user";
        membership = "pending";
        await assert.rejects(
          oauth.callback(callback(await start())),
          (e) => e instanceof DomainError && e.status === 403,
        );
        assert.equal(
          (
            await store.query("SELECT id FROM app_users WHERE github_id=$1", [
              "13",
            ])
          ).length,
          0,
        );
        membership = "active";
        const denied = await start();
        const request = callback(denied);
        await assert.rejects(
          oauth.callback(
            new Request(request.url + "&error=access_denied", {
              headers: request.headers,
            }),
          ),
          /취소/,
        );
      },
    );
    await t.test(
      "비공개 공간은 자동 참여하지 않으며 공개 공간·신선한 조직 인증·멤버 제외를 지킨다",
      async () => {
        const workspaces = new Workspaces(store, local.user.id),
          hidden = await workspaces.create({ name: "비공개" }),
          shared = await workspaces.create({ name: "조직 공개" });
        await store.query(
          "UPDATE workspace_settings SET github_org_join=true WHERE id=$1",
          [shared!.id],
        );
        const request = new Request(
          "https://pm.example.test/api/auth/workspaces/available",
          { headers: { cookie: `pm_session=${oauthSession.session.token}` } },
        );
        const available = await users.availableGitHubWorkspaces(request);
        assert.deepEqual(
          available.workspaces.map((w) => w.id),
          [shared!.id],
        );
        await assert.rejects(
          users.joinGitHubWorkspace(request, { id: hidden!.id }),
          (e) => e instanceof DomainError && e.status === 403,
        );
        await users.joinGitHubWorkspace(request, { id: shared!.id });
        assert.equal(
          (
            await new Workspaces(store, oauthSession.session.user.id).get(
              shared!.id,
            )
          ).role,
          "member",
        );
        await workspaces.removeMember(shared!.id, {
          userId: oauthSession.session.user.id,
          expectedRole: "member",
        });
        await assert.rejects(
          users.joinGitHubWorkspace(request, { id: shared!.id }),
          (e) => e instanceof DomainError && e.status === 403,
        );
        await store.query(
          "UPDATE app_users SET github_org_verified_at=now()-interval '11 minutes' WHERE id=$1",
          [oauthSession.session.user.id],
        );
        await assert.rejects(
          users.availableGitHubWorkspaces(request),
          /다시 인증/,
        );
      },
    );
  } finally {
    await store.close();
    for (const key of names) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
