import assert from "node:assert/strict";
import test from "node:test";
import {
  generateKeyPairSync,
  verify,
  createHmac,
  randomUUID,
} from "node:crypto";
import { GitHubApp, configuredGitHubApp } from "../src/github/app";
import { GitHubClient } from "../src/github/client";
import { DomainError } from "../src/core/model";
import { Store } from "../src/db/store";
import { Users } from "../src/users/service";
import { Service } from "../src/core/service";
import { Workspaces } from "../src/workspaces/service";
import { receiveGithubWebhook } from "../src/webhooks/github";
import { SyncQueue } from "../src/jobs/queue";

const keys = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { format: "pem", type: "pkcs8" },
  publicKeyEncoding: { format: "pem", type: "spki" },
});
function fixture(realClock = false) {
  let now = Date.parse("2026-11-02T00:00:00Z"),
    issued = 0,
    denied = false,
    foreign = false,
    suspended = false;
  const clock = () => (realClock ? Date.now() : now);
  const calls: {
    path: string;
    method: string;
    authorization: string | null;
  }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const authorization = new Headers(init?.headers).get("authorization");
    const method = init?.method ?? "GET";
    calls.push({ path, method, authorization });
    if (path === "/orgs/org/installation" || path === "/app/installations/77") {
      if (denied)
        return Response.json({ message: "Forbidden" }, { status: 403 });
      return Response.json({
        id: 77,
        app_id: 1234,
        account: { login: foreign ? "other" : "ORG" },
        suspended_at: suspended ? "2026-11-01T00:00:00Z" : null,
      });
    }
    if (path === "/app/installations/77/access_tokens") {
      assert.equal(method, "POST");
      const jwt = authorization!.slice(7),
        [header, payload, signature] = jwt.split(".");
      assert.equal(
        verify(
          "RSA-SHA256",
          Buffer.from(`${header}.${payload}`),
          keys.publicKey,
          Buffer.from(signature!, "base64url"),
        ),
        true,
      );
      const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
      assert.equal(claims.iss, "1234");
      assert.equal(claims.iat, Math.floor(clock() / 1000) - 60);
      assert.ok(claims.exp <= Math.floor(clock() / 1000) + 600);
      issued++;
      return Response.json(
        {
          token: `synthetic-installation-${issued}`,
          expires_at: new Date(clock() + 3600000).toISOString(),
        },
        { status: 201 },
      );
    }
    if (path === "/installation/repositories")
      return Response.json({
        total_count: 1,
        repositories: [{ full_name: "Org/Allowed" }],
      });
    if (path === "/repos/org/allowed")
      return Response.json({ full_name: "org/allowed" });
    throw new Error(`Unsupported test path: ${path}`);
  };
  const app = new GitHubApp({
    appId: "1234",
    organization: "org",
    privateKey: keys.privateKey,
    fetch: fetcher,
    now: clock,
  });
  return {
    app,
    clock,
    fetcher,
    calls,
    get issued() {
      return issued;
    },
    advance(ms: number) {
      now += ms;
    },
    deny() {
      denied = true;
    },
    foreign() {
      foreign = true;
    },
    suspend() {
      suspended = true;
    },
  };
}

test("App JWT 서명·설치 범위·동시 토큰 발급 억제·만료 전 갱신", async () => {
  const f = fixture();
  const scopes = await Promise.all(
    Array.from({ length: 12 }, () => f.app.access()),
  );
  assert.equal(f.issued, 1);
  assert.ok(
    scopes.every((scope) => scope.token === "synthetic-installation-1"),
  );
  assert.deepEqual(scopes[0]!.repositories, ["org/allowed"]);
  f.advance(58 * 60000);
  assert.equal(await f.app.token(), "synthetic-installation-1");
  f.advance(61000);
  assert.equal(await f.app.token(), "synthetic-installation-2");
  assert.equal(f.issued, 2);
});
test("설치 권한 철회·다른 조직·일시 중지는 이전 범위를 재사용하지 않는다", async () => {
  for (const failure of ["deny", "foreign", "suspend"] as const) {
    const f = fixture();
    await f.app.access();
    f.advance(61000);
    f[failure]();
    await assert.rejects(
      f.app.access(),
      (error) => error instanceof DomainError && error.status === 503,
    );
  }
  assert.throws(
    () =>
      new GitHubApp({
        appId: "1234",
        organization: "org",
        privateKey: "not-a-private-key",
      }),
    /개인 키/,
  );
});
test("설치 수명 변경 중 발급 중인 토큰은 캐시에 반영하지 않는다", async () => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture();
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).endsWith("/access_tokens")) await barrier;
    return f.fetcher(input, init);
  };
  const app = new GitHubApp({
    appId: "1234",
    organization: "org",
    privateKey: keys.privateKey,
    fetch: fetcher,
    now: f.clock,
  });
  const pending = app.token();
  await new Promise((resolve) => setTimeout(resolve, 10));
  app.invalidate();
  release();
  await assert.rejects(pending, /설치가 변경/);
});
test("GitHubClient는 설치 저장소만 열거하고 요청마다 토큰 공급자를 사용한다", async () => {
  const f = fixture();
  const client = new GitHubClient({
    tokenProvider: f.app.token,
    installationScoped: true,
    fetch: f.fetcher,
  });
  assert.deepEqual(await client.listOrganizationRepositories("org"), [
    { full_name: "Org/Allowed" },
  ]);
  await client.get("/repos/org/allowed");
  f.advance(3600000);
  await client.get("/repos/org/allowed");
  assert.equal(f.issued, 2);
  assert.ok(!f.calls.some((call) => call.path === "/orgs/org/repos"));
  assert.deepEqual(
    f.calls
      .filter((call) => call.path === "/repos/org/allowed")
      .map((call) => call.authorization),
    ["Bearer synthetic-installation-1", "Bearer synthetic-installation-2"],
  );
});
test("설치 조회 중 변경된 설치 응답으로 토큰을 발급하지 않는다", async () => {
  let release!: () => void;
  let entered!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const f = fixture();
  let blocked = true;
  const app = new GitHubApp({
    appId: "1234",
    organization: "org",
    privateKey: keys.privateKey,
    fetch: async (input, init) => {
      if (blocked && String(input).endsWith("/installation")) {
        entered();
        await barrier;
      }
      return f.fetcher(input, init);
    },
    now: f.clock,
  });
  const pending = app.access();
  await started;
  app.invalidate();
  release();
  await assert.rejects(pending, /설치가 변경/);
  assert.equal(f.issued, 0);
  blocked = false;
  f.deny();
  await assert.rejects(app.access(), /HTTP 403/);
  assert.equal(f.issued, 0);
});
test("App 공유는 지정 워크스페이스에 한정되고 개인 PAT 범위·MCP 쓰기 권한을 확대하지 않는다", async () => {
  const environment = { ...process.env };
  for (const key of [
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY_BASE64",
    "GITHUB_APP_PRIVATE_KEY_PATH",
    "GITHUB_APP_CLIENT_ID",
    "GITHUB_APP_INSTALLATION_ID",
    "GITHUB_APP_WORKSPACE_ID",
    "DEMO_MODE",
  ])
    delete process.env[key];
  process.env.GITHUB_ORG = "org";
  process.env.TOKEN_ENCRYPTION_KEY = "11".repeat(32);
  const store = new Store(),
    f = fixture(true),
    users = new Users(store, f.fetcher);
  try {
    const registered = await users.register({
      login: "planner",
      password: "long-test-password",
      displayName: "기획자",
    });
    const request = (
      token = registered.token,
      api = false,
      workspace = "main",
    ) =>
      new Request("http://localhost/api/dashboard", {
        headers: {
          ...(api
            ? { authorization: `Bearer ${token}` }
            : { cookie: `pm_session=${token}` }),
          "X-Workspace-Id": workspace,
        },
      });
    const service = new Service(store, { name: "seed", role: "write" });
    await service.saveProject({
      id: "allowed",
      name: "허용",
      goal: "",
      repositories: ["org/allowed"],
    });
    await service.saveProject({
      id: "private",
      name: "미설치",
      goal: "",
      repositories: ["org/private"],
    });
    await store.query(
      "UPDATE app_users SET repositories='[\"org/private\"]'::jsonb,github_cipher='invalid-old-pat' WHERE id=$1",
      [registered.user.id],
    );
    process.env.GITHUB_APP_ID = "1234";
    process.env.GITHUB_APP_PRIVATE_KEY_BASE64 = Buffer.from(
      keys.privateKey,
    ).toString("base64");
    const resolved = await users.resolve(request());
    assert.deepEqual(resolved.actor.repositories, ["org/allowed"]);
    assert.equal(typeof resolved.actor.githubTokenProvider, "function");
    assert.deepEqual(
      (await new Service(store, resolved.actor).dashboard()).projects.map(
        (row) => row.data.id,
      ),
      ["allowed"],
    );
    assert.ok(
      !JSON.stringify(await users.workspace(request())).includes(
        "synthetic-installation",
      ),
    );
    const token = await users.rotateApiToken(request(), "read");
    const reader = await users.resolve(request(token.token, true));
    assert.equal(reader.actor.role, "read");
    await assert.rejects(
      new Service(store, reader.actor).saveProject({
        id: "denied",
        name: "쓰기 금지",
        goal: "",
        repositories: [],
      }),
      (error) => error instanceof DomainError && error.status === 403,
    );
    const other = await new Workspaces(store, registered.user.id).create({
      name: "다른 공간",
    });
    await store.query(
      "UPDATE app_users SET repositories='[]'::jsonb,github_cipher='' WHERE id=$1",
      [registered.user.id],
    );
    const isolated = await users.resolve(
      request(registered.token, false, other.id),
    );
    assert.deepEqual(isolated.actor.repositories, []);
    assert.equal(isolated.actor.githubTokenProvider, undefined);
    f.deny();
    configuredGitHubApp(f.fetcher)!.invalidate();
    await assert.rejects(
      users.resolve(request()),
      (error) => error instanceof DomainError && error.status === 503,
    );
    assert.equal((await users.profile(request())).login, "planner");
  } finally {
    await store.close();
    for (const key of Object.keys(process.env))
      if (!(key in environment)) delete process.env[key];
    Object.assign(process.env, environment);
  }
});
test("App 웹훅의 별도 서명·설치 ID·조직 검증과 캐시 무효화는 기존 웹훅을 유지한다", async () => {
  const store = new Store(),
    queue = new SyncQueue(store);
  let invalidations = 0;
  const request = (event: string, body: unknown, secret = "app-secret") => {
    const text = JSON.stringify(body);
    return new Request("http://localhost/api/webhooks/github", {
      method: "POST",
      body: text,
      headers: {
        "x-github-event": event,
        "x-github-delivery": randomUUID(),
        "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(text).digest("hex")}`,
      },
    });
  };
  const options = {
    secret: "legacy-secret",
    appSecret: "app-secret",
    appInstallationId: "77",
    organization: "org",
    onAppInstallationChanged: () => {
      invalidations++;
    },
  };
  try {
    assert.equal(
      (await receiveGithubWebhook(request("ping", {}), queue, options)).status,
      200,
    );
    assert.equal(
      (
        await receiveGithubWebhook(
          request("installation_repositories", {
            installation: { id: 77, account: { login: "org" } },
          }),
          queue,
          options,
        )
      ).status,
      202,
    );
    assert.equal(invalidations, 1);
    await assert.rejects(
      receiveGithubWebhook(
        request("installation", {
          installation: { id: 78, account: { login: "org" } },
        }),
        queue,
        options,
      ),
      (error) => error instanceof DomainError && error.status === 403,
    );
    await assert.rejects(
      receiveGithubWebhook(
        request("installation", {
          installation: { id: 77, account: { login: "other" } },
        }),
        queue,
        options,
      ),
    );
    await assert.rejects(
      receiveGithubWebhook(
        request(
          "issues",
          { installation: { id: 77 }, repository: { full_name: "org/repo" } },
          "wrong",
        ),
        queue,
        options,
      ),
      (error) => error instanceof DomainError && error.status === 401,
    );
    assert.equal(
      (
        await receiveGithubWebhook(
          request("issues", {
            installation: { id: 77 },
            repository: { full_name: "org/repo" },
          }),
          queue,
          options,
        )
      ).status,
      202,
    );
    assert.equal(
      (
        await receiveGithubWebhook(
          request(
            "issues",
            { repository: { full_name: "org/legacy" } },
            "legacy-secret",
          ),
          queue,
          options,
        )
      ).status,
      202,
    );
    assert.equal((await queue.list()).length, 2);
  } finally {
    await store.close();
  }
});
