import assert from "node:assert/strict";
import test from "node:test";
import {
  POST as auth,
  GET as authGet,
} from "../src/app/api/auth/[...action]/route";
import { GET as apiGet, POST as apiPost } from "../src/app/api/[...path]/route";
import { Store } from "../src/db/store";

test("HTTP 계정 등록·로그인 쿠키·프로필과 개인 API 권한", async () => {
  const envKeys = [
    "TOKEN_ENCRYPTION_KEY",
    "GITHUB_ORG",
    "DEMO_MODE",
    "APP_URL",
    "ALLOW_LEGACY_ACCESS",
  ] as const;
  const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  process.env.TOKEN_ENCRYPTION_KEY = "22".repeat(32);
  process.env.GITHUB_ORG = "org";
  process.env.APP_URL = "http://localhost";
  delete process.env.DEMO_MODE;
  delete process.env.ALLOW_LEGACY_ACCESS;
  const root = globalThis as typeof globalThis & { pmStore?: Store };
  const previous = root.pmStore,
    previousFetch = globalThis.fetch;
  const store = new Store();
  root.pmStore = store;
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === "/user")
      return Response.json({ login: "tester", name: "테스터" });
    if (path.includes("/memberships/"))
      return Response.json({ state: "active", role: "member" });
    if (path.includes("/repos"))
      return Response.json([{ full_name: "org/repo" }]);
    throw new Error("예상하지 못한 API");
  };
  const call = (action: string, body: unknown, cookie?: string) =>
    auth(
      new Request(`http://localhost/api/auth/${action}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ action: [action] }) },
    );
  try {
    const registration = await call("register", {
      password: "long-test-password",
      githubToken: "mock-private-token",
    });
    assert.equal(registration.status, 200);
    const header = registration.headers.get("set-cookie")!;
    assert.ok(header.includes("HttpOnly"));
    assert.ok(header.includes("SameSite=Lax"));
    const cookie = header.split(";")[0]!;
    const output = await registration.json();
    assert.equal(output.user.login, "tester");
    assert.ok(!JSON.stringify(output).includes("mock-private-token"));
    const profile = await authGet(
      new Request("http://localhost/api/auth/me", { headers: { cookie } }),
      { params: Promise.resolve({ action: ["me"] }) },
    );
    assert.equal(profile.status, 200);
    const updated = await call(
      "profile",
      { displayName: "새 표시 이름" },
      cookie,
    );
    assert.equal((await updated.json()).user.displayName, "새 표시 이름");
    const issued = await (
      await call("service-token", { role: "read" }, cookie)
    ).json();
    const dashboard = await apiGet(
      new Request("http://localhost/api/dashboard", {
        headers: { authorization: `Bearer ${issued.token}` },
      }),
      { params: Promise.resolve({ path: ["dashboard"] }) },
    );
    assert.equal(dashboard.status, 200);
    const data = await dashboard.json();
    assert.equal(data.viewer.role, "read");
    assert.ok(!JSON.stringify(data).includes("mock-private-token"));
    const forbidden = await apiPost(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { authorization: `Bearer ${issued.token}` },
        body: JSON.stringify({
          data: {
            id: "test",
            name: "프로젝트",
            goal: "",
            repositories: ["org/repo"],
          },
        }),
      }),
      { params: Promise.resolve({ path: ["projects"] }) },
    );
    assert.equal(forbidden.status, 403);
    const cross = await auth(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { origin: "https://evil.example", cookie },
        body: "{}",
      }),
      { params: Promise.resolve({ action: ["logout"] }) },
    );
    assert.equal(cross.status, 403);
    assert.equal((await call("logout", {}, cookie)).status, 200);
    assert.equal(
      (
        await authGet(
          new Request("http://localhost/api/auth/me", { headers: { cookie } }),
          { params: Promise.resolve({ action: ["me"] }) },
        )
      ).status,
      401,
    );
    assert.equal(
      (await call("login", { login: "tester", password: "long-test-password" }))
        .status,
      200,
    );
  } finally {
    globalThis.fetch = previousFetch;
    root.pmStore = previous;
    await store.close();
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});
