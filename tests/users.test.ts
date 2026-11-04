import assert from "node:assert/strict";
import test from "node:test";
import { Store } from "../src/db/store";
import { Users } from "../src/users/service";
import { Service } from "../src/core/service";
import { DomainError, type GitHubItem } from "../src/core/model";
import { encryptToken, decryptToken } from "../src/users/crypto";
const password = "long-test-password";
const request = (token: string, api = false) =>
  new Request("http://localhost/api/dashboard", {
    headers: api
      ? { authorization: `Bearer ${token}` }
      : { cookie: `pm_session=${token}` },
  });

test("사용자 로그인·암호화·개인 토큰과 저장소 권한", async (t) => {
  const saved = {
    key: process.env.TOKEN_ENCRYPTION_KEY,
    org: process.env.GITHUB_ORG,
    demo: process.env.DEMO_MODE,
    legacy: process.env.ALLOW_LEGACY_ACCESS,
  };
  process.env.TOKEN_ENCRYPTION_KEY = "11".repeat(32);
  process.env.GITHUB_ORG = "org";
  delete process.env.DEMO_MODE;
  delete process.env.ALLOW_LEGACY_ACCESS;
  const store = new Store(process.env.TEST_DATABASE_URL);
  let denied = false;
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const token = new Headers(init?.headers).get("authorization");
    const login = token?.includes("bob") ? "bob" : "alice";
    if (denied) return new Response("", { status: 403 });
    if (path === "/user")
      return Response.json({
        login,
        name: login === "alice" ? "앨리스" : "밥",
      });
    if (path.includes("/memberships/"))
      return Response.json({ state: "active", role: "member" });
    if (path === "/orgs/org/repos")
      return Response.json([{ full_name: "org/public" }]);
    throw new Error("예상하지 못한 API 요청");
  };
  const users = new Users(store, fetcher);
  try {
    const registered = await users.register({
      password,
      githubToken: "github-alice-secret",
    });
    const cookie = request(registered.token);
    await t.test(
      "GitHub 토큰은 암호화되고 비밀번호·세션·API 토큰은 원문을 저장하지 않는다",
      async () => {
        const row = (
          await store.query<{ github_cipher: string; password_hash: string }>(
            "SELECT github_cipher,password_hash FROM app_users",
          )
        )[0]!;
        assert.notEqual(row.github_cipher, "github-alice-secret");
        assert.equal(decryptToken(row.github_cipher), "github-alice-secret");
        assert.ok(!row.password_hash.includes(password));
        assert.ok(
          !JSON.stringify(registered.user).includes("github-alice-secret"),
        );
        assert.ok(
          !JSON.stringify(
            await store.query("SELECT * FROM app_sessions"),
          ).includes(registered.token),
        );
        const cipher = encryptToken("private");
        assert.throws(() => decryptToken(cipher.slice(0, -2) + "AA"));
      },
    );
    await t.test("로그인·개인 MCP 토큰·회전·폐기", async () => {
      await assert.rejects(
        users.login({ login: "alice", password: "wrong" }),
        (e) => e instanceof DomainError && e.status === 401,
      );
      assert.equal(
        (await users.login({ login: "Alice", password })).user.login,
        "alice",
      );
      const token = await users.rotateApiToken(cookie, "read");
      const resolved = await users.resolve(request(token.token, true));
      assert.equal(resolved.actor.role, "read");
      assert.deepEqual(resolved.actor.repositories, ["org/public"]);
      assert.ok(
        !JSON.stringify(
          await store.query("SELECT api_token_hash FROM app_users"),
        ).includes(token.token),
      );
      await assert.rejects(
        users.rotateApiToken(request(token.token, true), "write"),
        (e) => e instanceof DomainError && e.status === 403,
      );
      const next = await users.rotateApiToken(cookie, "write");
      await assert.rejects(users.resolve(request(token.token, true)));
      assert.equal(
        (await users.resolve(request(next.token, true))).actor.role,
        "write",
      );
      await users.revokeApiToken(cookie);
      await assert.rejects(users.resolve(request(next.token, true)));
    });
    await t.test(
      "다른 GitHub 계정 토큰과 만료 후 확인할 수 없는 권한은 거부한다",
      async () => {
        await assert.rejects(
          users.update(cookie, { githubToken: "github-bob-secret" }),
        );
        await store.query(
          "UPDATE app_users SET permissions_at=to_timestamp(0)",
        );
        denied = true;
        await assert.rejects(
          users.resolve(cookie),
          (e) => e instanceof DomainError && e.status === 403,
        );
        assert.equal((await users.profile(cookie)).repositoryCount, 0);
        denied = false;
        await users.update(cookie, { githubToken: "github-alice-new-secret" });
        assert.equal(
          (await users.resolve(cookie)).actor.repositories?.length,
          1,
        );
      },
    );
    await t.test(
      "로그아웃과 비밀번호 변경은 해당 세션·다른 세션을 무효화한다",
      async () => {
        const other = await users.login({ login: "alice", password });
        await users.changePassword(cookie, {
          currentPassword: password,
          newPassword: "new-long-test-password",
        });
        await assert.rejects(users.resolve(request(other.token)));
        await users.logout(cookie);
        await assert.rejects(users.resolve(cookie));
        assert.equal(
          (
            await users.login({
              login: "alice",
              password: "new-long-test-password",
            })
          ).user.login,
          "alice",
        );
      },
    );
    await t.test(
      "개인 저장소 범위는 현황·변경·프로젝트 수정에 동일하게 적용한다",
      async () => {
        const admin = new Service(store, { name: "system", role: "write" });
        await admin.saveProject({
          id: "public",
          name: "공개 작업",
          goal: "",
          repositories: ["org/public"],
        });
        await admin.saveProject({
          id: "private",
          name: "숨겨진 작업",
          goal: "",
          repositories: ["org/private"],
        });
        await admin.saveFeature({
          id: "private-feature",
          name: "숨겨진 기능",
          goal: "",
          project: "private",
        });
        await admin.saveTask({
          id: "PRIVATE-TASK",
          title: "비공개 작업",
          project: "private",
          feature: "private-feature",
        });
        const item: GitHubItem = {
          id: "org/private#1",
          repository: "org/private",
          number: 1,
          kind: "issue",
          title: "비공개 이슈",
          body: "secret",
          author: "bob",
          assignees: [],
          reviewers: [],
          state: "open",
          url: "https://github.com/org/private/issues/1",
          updatedAt: new Date().toISOString(),
        };
        await store.save("github", item.id, item, "system");
        const limited = new Service(store, {
          name: "alice",
          role: "write",
          userId: registered.user.id,
          repositories: ["org/public"],
        });
        const d = await limited.dashboard();
        assert.equal(d.projects.length, 1);
        assert.equal(d.tasks.length, 0);
        assert.equal(d.items.length, 0);
        assert.ok(!JSON.stringify(await limited.history()).includes("숨겨진"));
        await assert.rejects(
          limited.saveProject({
            id: "new",
            name: "불가",
            goal: "",
            repositories: ["org/private"],
          }),
        );
        await assert.rejects(
          limited.saveTask(
            {
              id: "PRIVATE-TASK",
              title: "불가",
              project: "private",
              feature: "private-feature",
            },
            1,
          ),
        );
      },
    );
    await t.test(
      "프로젝트 공개 범위가 바뀌어도 과거 비공개 저장소 이력을 노출하지 않는다",
      async () => {
        const trusted = new Service(store, { name: "system", role: "write" });
        await trusted.saveProject({
          id: "history-scope",
          name: "이전 내부 프로젝트",
          goal: "이전 비공개 목표",
          repositories: ["org/private"],
        });
        await trusted.saveProject(
          {
            id: "history-scope",
            name: "현재 공개 프로젝트",
            goal: "현재 공개 목표",
            repositories: ["org/public"],
          },
          1,
        );
        const limited = new Service(store, {
          name: "alice",
          role: "write",
          userId: registered.user.id,
          repositories: ["org/public"],
        });
        const history = JSON.stringify(await limited.history());
        assert.ok(!history.includes("이전 비공개 목표"));
        assert.ok(!history.includes("org/private"));
      },
    );
    await t.test("반복 로그인 시도 제한", async () => {
      for (let i = 0; i < 10; i++)
        await assert.rejects(
          users.login({ login: "missing", password: "wrong" }),
        );
      await assert.rejects(
        users.login({ login: "missing", password: "wrong" }),
        (e) => e instanceof DomainError && e.status === 429,
      );
    });
  } finally {
    await store.close();
    for (const [key, value] of Object.entries({
      TOKEN_ENCRYPTION_KEY: saved.key,
      GITHUB_ORG: saved.org,
      DEMO_MODE: saved.demo,
      ALLOW_LEGACY_ACCESS: saved.legacy,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
