import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Store } from "../src/db/store";
import { Users } from "../src/users/service";
import { handleOAuth, oauthMetadata } from "../src/mcp/oauth";
import { resolveOAuthAccess } from "../src/mcp/oauth-access";

test("MCP OAuth는 브라우저 동의·PKCE·리소스·워크스페이스·읽기 범위와 회전 토큰 재사용을 검증한다", async () => {
  const saved = {
    APP_URL: process.env.APP_URL,
    DEMO_MODE: process.env.DEMO_MODE,
  };
  process.env.APP_URL = "http://localhost";
  delete process.env.DEMO_MODE;
  const store = new Store(),
    users = new Users(store);
  try {
    const session = await users.register({
      login: "owner",
      displayName: "PM",
      password: "long-test-password",
    });
    const request = (path: string, body?: unknown, cookie = "") =>
      new Request("http://localhost" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(body === undefined
            ? {}
            : {
                "Content-Type": "application/json",
                Origin: "http://localhost",
              }),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const registered = await handleOAuth(
      store,
      request("/oauth/register", {
        client_name: "테스트 클라이언트",
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "none",
      }),
      "register",
    );
    assert.equal(registered.status, 201);
    const client = await registered.json();
    const resource = "http://localhost/api/mcp",
      verifier = randomBytes(32).toString("base64url"),
      challenge = createHash("sha256").update(verifier).digest("base64url"),
      params = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: "https://client.example/callback",
        response_type: "code",
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource,
        scope: "cloud-pm:read cloud-pm:write",
        state: "original-state",
      });
    const authorize = await handleOAuth(
      store,
      request("/oauth/authorize?" + params),
      "authorize",
    );
    assert.equal(authorize.status, 302);
    const pending = new URL(
        authorize.headers.get("location")!,
      ).searchParams.get("request")!,
      cookies = `pm_session=${session.token}; ${authorize.headers.get("set-cookie")!.split(";")[0]}`;
    const infoResponse = await handleOAuth(
      store,
      request(
        "/api/auth/mcp/oauth/consent?request=" + pending,
        undefined,
        cookies,
      ),
      "consent",
    );
    assert.equal(infoResponse.status, 200);
    const info = await infoResponse.json();
    const invalid = await handleOAuth(
      store,
      request(
        "/api/auth/mcp/oauth/consent",
        {
          request: pending,
          csrf: "x".repeat(43),
          expectedUserId: session.user.id,
          workspaceId: "main",
          decision: "allow",
          role: "read",
        },
        cookies,
      ),
      "consent",
    );
    assert.equal(invalid.status, 403);
    const consent = await handleOAuth(
      store,
      request(
        "/api/auth/mcp/oauth/consent",
        {
          request: pending,
          csrf: info.csrf,
          expectedUserId: session.user.id,
          workspaceId: "main",
          decision: "allow",
          role: "read",
        },
        cookies,
      ),
      "consent",
    );
    assert.equal(consent.status, 200);
    const redirect = new URL((await consent.json()).redirect),
      code = redirect.searchParams.get("code")!;
    assert.equal(redirect.searchParams.get("state"), "original-state");
    assert.equal(redirect.searchParams.get("iss"), "http://localhost");
    const tokenCall = (body: Record<string, string>) =>
      handleOAuth(
        store,
        new Request("http://localhost/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(body),
        }),
        "token",
      );
    const tokenBody = {
      grant_type: "authorization_code",
      client_id: client.client_id,
      code,
      redirect_uri: "https://client.example/callback",
      code_verifier: verifier,
      resource,
    };
    assert.equal(
      (await tokenCall({ ...tokenBody, code_verifier: "z".repeat(43) })).status,
      400,
    );
    assert.equal(
      (
        await tokenCall({
          ...tokenBody,
          resource: "https://other.example/api/mcp",
        })
      ).status,
      400,
    );
    const tokenResponse = await tokenCall(tokenBody);
    assert.equal(tokenResponse.status, 200);
    const token = await tokenResponse.json();
    assert.equal(token.scope, "cloud-pm:read");
    assert.equal(
      (await resolveOAuthAccess(store, token.access_token)).workspace_id,
      "main",
    );
    const resolved = await users.resolve(
      new Request(resource, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      }),
    );
    assert.equal(resolved.actor.role, "read");
    assert.equal(resolved.actor.userId, session.user.id);
    await assert.rejects(
      users.resolve(
        new Request("http://localhost/api/dashboard", {
          headers: { Authorization: `Bearer ${token.access_token}` },
        }),
      ),
    );
    await assert.rejects(
      users.resolve(
        new Request(resource, {
          headers: {
            Authorization: `Bearer ${token.access_token}`,
            "X-Workspace-Id": "other",
          },
        }),
      ),
    );
    const refreshed = await tokenCall({
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: token.refresh_token,
      resource,
    });
    assert.equal(refreshed.status, 200);
    const next = await refreshed.json();
    assert.notEqual(next.refresh_token, token.refresh_token);
    const replay = await tokenCall({
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: token.refresh_token,
      resource,
    });
    assert.equal(replay.status, 400);
    await assert.rejects(resolveOAuthAccess(store, next.access_token));
    const metadata = await oauthMetadata(
      "oauth-protected-resource/api/mcp",
    ).json();
    assert.equal(metadata.resource, resource);
    assert.equal(
      (
        await handleOAuth(
          store,
          request("/oauth/register", {
            redirect_uris: ["javascript:alert(1)"],
          }),
          "register",
        )
      ).status,
      400,
    );
  } finally {
    await store.close();
    for (const [key, value] of Object.entries(saved))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
