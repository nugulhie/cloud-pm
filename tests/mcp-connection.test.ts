import assert from "node:assert/strict";
import test from "node:test";
import { Store } from "../src/db/store";
import { Users } from "../src/users/service";
import { POST, GET } from "../src/app/api/mcp/route";
import { GET as health } from "../src/app/api/health/route";
import { checkMcpConnection, checkUrl } from "../src/mcp/check";
import {
  connectionAddress,
  MCP_BODY_LIMIT,
  readMcpBody,
} from "../src/mcp/connection";

test("MCP 주소 형식·CLI HTTPS 제한과 스트리밍 본문 크기 검증", async () => {
  assert.equal(connectionAddress("https://pm.example.com").publicHttps, true);
  for (const url of [
    "http://pm.example.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://192.168.1.10",
    "https://[::1]",
    "https://pm.internal",
  ])
    assert.equal(connectionAddress(url).publicHttps, false);
  assert.equal(connectionAddress("https://user:secret@example.com").url, null);
  assert.equal(connectionAddress("invalid").configured, false);
  assert.equal(checkUrl("http://127.0.0.1:3000/api/mcp").hostname, "127.0.0.1");
  for (const url of [
    "http://public.example.com/api/mcp",
    "https://user:secret@example.com",
    "https://example.com?token=secret",
    "https://example.com/#secret",
  ])
    assert.throws(() => checkUrl(url));
  const body = { jsonrpc: "2.0", id: 1, method: "ping" };
  assert.deepEqual(
    await readMcpBody(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    ),
    body,
  );
  await assert.rejects(
    readMcpBody(
      new Request("http://localhost", { method: "POST", body: "invalid" }),
    ),
    /JSON/,
  );
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(60000));
      controller.enqueue(new Uint8Array(60000));
      controller.close();
    },
  });
  await assert.rejects(
    readMcpBody(
      new Request("http://localhost", {
        method: "POST",
        body: stream,
        duplex: "half",
      } as RequestInit),
    ),
    /너무 큽니다/,
  );
  await assert.rejects(
    readMcpBody(
      new Request("http://localhost", {
        method: "POST",
        body: "가".repeat(MCP_BODY_LIMIT),
      }),
    ),
    /너무 큽니다/,
  );
});

test("실제 HTTP MCP 인증·SDK 점검·접속 기록·토큰 회전과 상태·헬스", async () => {
  const keys = [
    "TOKEN_ENCRYPTION_KEY",
    "GITHUB_ORG",
    "APP_URL",
    "DEMO_MODE",
    "ALLOW_LEGACY_ACCESS",
  ] as const;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.TOKEN_ENCRYPTION_KEY = "99".repeat(32);
  process.env.GITHUB_ORG = "org";
  process.env.APP_URL = "http://localhost";
  delete process.env.DEMO_MODE;
  delete process.env.ALLOW_LEGACY_ACCESS;
  const root = globalThis as typeof globalThis & { pmStore?: Store };
  const previous = root.pmStore,
    store = new Store();
  root.pmStore = store;
  const users = new Users(store, async (input, init) => {
    const path = new URL(String(input)).pathname;
    const login =
      new Headers(init?.headers).get("authorization")?.replace("Bearer ", "") ??
      "";
    if (path === "/user") return Response.json({ login, name: login });
    if (path.includes("/memberships/"))
      return Response.json({ state: "active", role: "member" });
    return Response.json([{ full_name: "org/repo" }]);
  });
  const request = (token: string) =>
    new Request("http://localhost/api/auth/mcp/status", {
      headers: { cookie: `pm_session=${token}` },
    });
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  try {
    const account = await users.register({
        githubToken: "owner",
        password: "long-test-password",
      }),
      browser = request(account.token);
    const token = (await users.rotateApiToken(browser, "write")).token;
    const unauth = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers,
        body: "{}",
      }),
    );
    assert.equal(unauth.status, 401);
    assert.equal(
      unauth.headers.get("WWW-Authenticate"),
      'Bearer realm="cloud-pm-agent"',
    );
    assert.equal(unauth.headers.get("Cache-Control"), "no-store");
    const fetcher: typeof fetch = async (input, init) => {
      assert.equal(init?.redirect, "error");
      const url = input instanceof Request ? input.url : String(input);
      const incoming = new Request(url, init);
      if (incoming.method === "POST") return POST(incoming);
      return GET();
    };
    const result = await checkMcpConnection(
      "http://localhost/api/mcp",
      token,
      fetcher,
    );
    assert.equal(result.server, "cloud-pm-agent");
    assert.equal(result.writeSupported, true);
    assert.ok(result.tools > 10);
    const status = await users.mcpStatus(browser);
    assert.equal(status.publicHttps, false);
    assert.equal(status.workspace.id, "main");
    assert.equal(status.lastConnection?.client, "cloud-pm-cli-check");
    assert.equal(status.lastConnection?.method, "tools/list");
    assert.ok(!JSON.stringify(status).includes(token));
    const otherWorkspace = await users.createWorkspace(browser, {
      name: "다른 연결 공간",
    });
    const otherBrowser = new Request(browser.url, {
      headers: {
        cookie: `pm_session=${account.token}`,
        "X-Workspace-Id": otherWorkspace.id,
      },
    });
    const otherStatus = await users.mcpStatus(otherBrowser);
    assert.equal(otherStatus.token.currentWorkspace, false);
    assert.equal(otherStatus.lastConnection, null);
    const wrongWorkspace = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          ...headers,
          Authorization: `Bearer ${token}`,
          "X-Workspace-Id": otherWorkspace.id,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      }),
    );
    assert.equal(wrongWorkspace.status, 403);
    const connectionRows = await store.query<{ token_hash: string }>(
      "SELECT token_hash FROM mcp_connections",
    );
    assert.notEqual(connectionRows[0]?.token_hash, token);
    const badOrigin = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          ...headers,
          Authorization: `Bearer ${token}`,
          Origin: "https://wrong.example.com",
        },
        body: "{}",
      }),
    );
    assert.equal(badOrigin.status, 403);
    const tooLarge = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { ...headers, Authorization: `Bearer ${token}` },
        body: "x".repeat(MCP_BODY_LIMIT + 1),
      }),
    );
    assert.equal(tooLarge.status, 413);
    const malformed = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { ...headers, Authorization: `Bearer ${token}` },
        body: "{",
      }),
    );
    assert.equal(malformed.status, 400);
    const next = (await users.rotateApiToken(browser, "read")).token;
    assert.equal((await users.mcpStatus(browser)).lastConnection, null);
    await assert.rejects(
      checkMcpConnection("http://localhost/api/mcp", token, fetcher),
      /연결 점검/,
    );
    assert.equal(
      (await checkMcpConnection("http://localhost/api/mcp", next, fetcher))
        .writeSupported,
      false,
    );
    await assert.rejects(
      users.mcpStatus(
        new Request("http://localhost/api/auth/mcp/status", {
          headers: { Authorization: `Bearer ${next}` },
        }),
      ),
      /브라우저/,
    );
    await users.revokeApiToken(browser);
    assert.equal((await users.mcpStatus(browser)).token.exists, false);
    assert.equal((await users.mcpStatus(browser)).lastConnection, null);
    assert.deepEqual(await (await health()).json(), { status: "ok" });
    const originalQuery = store.query.bind(store);
    store.query = async () => {
      throw new Error("database-password-must-not-leak");
    };
    const failed = await health();
    assert.equal(failed.status, 503);
    assert.ok(!(await failed.text()).includes("password"));
    store.query = originalQuery;
  } finally {
    root.pmStore = previous;
    await store.close();
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
