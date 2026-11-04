import assert from "node:assert/strict";
import test from "node:test";
import { Store } from "../src/db/store";
import { Users } from "../src/users/service";
import { Service } from "../src/core/service";
import { DomainError } from "../src/core/model";
import type { KnowledgeEntry } from "../src/core/knowledge-model";
import { decryptToken } from "../src/users/crypto";

test("GitHub 없는 PM의 초대 가입·공용 연결·PRD·정책·용어집과 워크스페이스 권한", async (t) => {
  const saved = {
    key: process.env.TOKEN_ENCRYPTION_KEY,
    org: process.env.GITHUB_ORG,
    demo: process.env.DEMO_MODE,
  };
  process.env.TOKEN_ENCRYPTION_KEY = "63".repeat(32);
  process.env.GITHUB_ORG = "org";
  delete process.env.DEMO_MODE;
  const store = new Store();
  let calls = 0,
    denied = false;
  const fetcher: typeof fetch = async (input) => {
    calls++;
    if (denied) return new Response("", { status: 403 });
    const path = new URL(String(input)).pathname;
    if (path === "/user")
      return Response.json({ login: "owner", name: "연동 관리자" });
    if (path.includes("memberships"))
      return Response.json({ state: "active", role: "admin" });
    if (path === "/orgs/org/repos")
      return Response.json([{ full_name: "org/app" }]);
    throw new Error(`예상하지 못한 호출 ${path}`);
  };
  const users = new Users(store, fetcher),
    request = (token: string, workspace = "main", api = false) =>
      new Request("http://localhost/api/dashboard", {
        headers: {
          ...(api
            ? { authorization: `Bearer ${token}` }
            : { cookie: `pm_session=${token}` }),
          "X-Workspace-Id": workspace,
        },
      });
  const forbidden = (e: unknown) =>
    e instanceof DomainError && e.status === 403;
  try {
    const owner = await users.register({
        githubToken: "test-shared-owner-token",
        password: "long-test-password",
      }),
      o = request(owner.token);
    await users.updateWorkspace(o, { inviteOnly: true });
    await assert.rejects(
      users.register({ login: "no-invite", password: "long-test-password" }),
      forbidden,
    );
    const invite = await users.createInvite(o, { login: "pm-planner" });
    const token = new URLSearchParams(new URL(invite.url).hash.slice(1)).get(
      "invite",
    )!;
    const before = calls,
      pm = await users.register({
        login: "pm-planner",
        displayName: "기획자",
        password: "long-test-password",
        inviteToken: token,
      }),
      p = request(pm.token);
    assert.equal(calls, before);
    assert.equal(pm.user.githubConnected, false);
    assert.equal(pm.user.githubLogin, null);
    assert.equal((await users.resolve(p)).actor.workspaceRole, "member");
    await assert.rejects(
      users.register({
        login: "duplicate",
        password: "long-test-password",
        inviteToken: token,
      }),
    );
    await t.test(
      "GitHub 미연결 상태에서도 내부 정책과 용어를 관리한다",
      async () => {
        const service = new Service(store, (await users.resolve(p)).actor);
        await service.saveKnowledge({
          id: "policy",
          kind: "policy",
          name: "초대 정책",
          content: "초대 링크는 **7일** 후 만료된다.",
          category: "계정",
          status: "active",
          owner: "pm-planner",
        });
        await service.saveKnowledge({
          id: "term",
          kind: "glossary",
          name: "PRD",
          content: "제품 요구사항 문서",
          aliases: ["제품 요구사항", "요구사항 정의서"],
        });
        assert.equal((await service.dashboard()).knowledge.length, 2);
        await assert.rejects(
          service.saveKnowledge({
            id: "term-dup",
            kind: "glossary",
            name: "prd",
            content: "중복",
          }),
          (e) => e instanceof DomainError && e.status === 409,
        );
        const current = (await store.get<KnowledgeEntry>("knowledge", "term"))!;
        await service
          .saveKnowledge(
            { ...current.data, editor: undefined },
            current.revision,
          )
          .then(
            () => assert.fail("편집자 입력은 거부해야 함"),
            () => {},
          );
        const { editor, ...data } = current.data;
        await service.saveKnowledge(
          { ...data, content: "제품 요구사항을 정의한 문서" },
          current.revision,
        );
        await assert.rejects(
          service.saveKnowledge(data, current.revision),
          (e) => e instanceof DomainError && e.status === 409,
        );
        await assert.rejects(
          users.updateWorkspaceGithub(p, { usePersonal: true }),
          forbidden,
        );
      },
    );
    await t.test(
      "관리자 공용 연결을 통해 GitHub 계정 없는 PM도 동일한 프로젝트를 본다",
      async () => {
        const result = await users.updateWorkspaceGithub(o, {
          usePersonal: true,
        });
        assert.equal(result.githubConnection?.repositoryCount, 1);
        const stored = (
          await store.query<{ github_cipher: string }>(
            "SELECT github_cipher FROM workspace_github WHERE workspace_id='main'",
          )
        )[0]!;
        assert.equal(
          decryptToken(stored.github_cipher),
          "test-shared-owner-token",
        );
        assert.ok(!JSON.stringify(result).includes("test-shared-owner-token"));
        const actor = (await users.resolve(p)).actor;
        assert.deepEqual(actor.repositories, ["org/app"]);
        assert.equal(actor.githubToken, "test-shared-owner-token");
        const service = new Service(store, actor);
        await service.saveProject({
          id: "product",
          name: "제품",
          goal: "",
          repositories: ["org/app"],
        });
        await service.saveRequirement({
          id: "prd",
          project: "product",
          featureName: "초대",
          policyIds: ["policy"],
          glossaryIds: ["term"],
        });
        await assert.rejects(
          service.deleteKnowledge({ id: "policy", revision: 1 }),
          /참조/,
        );
        await assert.rejects(
          service.saveRequirement({
            id: "bad-ref",
            project: "product",
            featureName: "오류",
            policyIds: ["term"],
          }),
        );
        await service.convertRequirements({
          entries: [{ id: "prd", revision: 1 }],
        });
        const preview = await service.previewRequirementIssue({
          id: "prd",
          revision: 2,
          repository: "org/app",
        });
        assert.match(preview.body, /관련 정책: 초대 정책/);
        assert.match(preview.body, /관련 용어: PRD/);
        const policy = (await store.get<KnowledgeEntry>(
          "knowledge",
          "policy",
        ))!;
        const { editor, ...policyData } = policy.data;
        await service.saveKnowledge(
          {
            ...policyData,
            content: "수정된 정책 · 초대 링크는 3일 후 만료된다.",
          },
          policy.revision,
        );
        await assert.rejects(
          service.previewRequirementIssue({
            id: "prd",
            revision: 2,
            repository: "org/app",
            previewHash: preview.previewHash,
          }),
          (e) => e instanceof DomainError && e.status === 409,
        );
        const discussion = await service.listComments("prd-task-prd");
        assert.ok(discussion.members.some((m) => m.login === "pm-planner"));
        const data = await service.dashboard();
        assert.equal(data.projects.length, 1);
        assert.ok(!JSON.stringify(data).includes("test-shared-owner-token"));
      },
    );
    await t.test(
      "조회 전용 역할·다른 워크스페이스·연결 해제 시 접근을 제한한다",
      async () => {
        const invite = await users.createInvite(o, { role: "viewer" });
        const inviteToken = new URLSearchParams(
          new URL(invite.url).hash.slice(1),
        ).get("invite")!;
        const viewer = await users.register({
          login: "pm-viewer",
          password: "long-test-password",
          inviteToken,
        });
        const service = new Service(
          store,
          (await users.resolve(request(viewer.token))).actor,
        );
        assert.equal((await service.dashboard()).projects.length, 1);
        await assert.rejects(
          service.saveKnowledge({
            id: "forbidden",
            kind: "policy",
            name: "불가",
            content: "내용",
          }),
          forbidden,
        );
        await assert.rejects(
          users.rotateApiToken(request(viewer.token), "write"),
          forbidden,
        );
        const ws = await users.createWorkspace(p, {
          name: "개별 워크스페이스",
        });
        const isolated = new Service(
          store,
          (await users.resolve(request(pm.token, ws.id))).actor,
        );
        assert.equal((await isolated.dashboard()).knowledge.length, 0);
        assert.equal((await isolated.dashboard()).items.length, 0);
        await assert.rejects(
          isolated.saveRequirement({
            id: "cross",
            project: "product",
            featureName: "침범",
          }),
          forbidden,
        );
        await users.updateWorkspaceGithub(o, { disconnect: true });
        assert.deepEqual((await users.resolve(p)).actor.repositories, []);
        assert.equal(
          (await new Service(store, (await users.resolve(p)).actor).dashboard())
            .projects.length,
          0,
        );
        await users.updateWorkspaceGithub(o, { usePersonal: true });
      },
    );
    await t.test(
      "공용 토큰 검증 실패 시 권한을 닫고 관리자는 프로필에서 복구할 수 있다",
      async () => {
        await store.query(
          "UPDATE workspace_github SET permissions_at=to_timestamp(0)",
        );
        denied = true;
        await assert.rejects(users.resolve(p), forbidden);
        assert.equal(
          (await users.workspace(o)).githubConnection?.repositoryCount,
          0,
        );
        denied = false;
        await users.updateWorkspaceGithub(o, { usePersonal: true });
        assert.equal((await users.resolve(p)).actor.repositories?.length, 1);
        const api = await users.rotateApiToken(p, "write");
        assert.equal(
          (await users.resolve(request(api.token, "main", true))).actor.role,
          "write",
        );
        await users.removeMember(o, {
          userId: pm.user.id,
          expectedRole: "member",
        });
        await assert.rejects(users.resolve(p), forbidden);
        await assert.rejects(users.resolve(request(api.token, "main", true)));
      },
    );
  } finally {
    await store.close();
    for (const [key, value] of Object.entries({
      TOKEN_ENCRYPTION_KEY: saved.key,
      GITHUB_ORG: saved.org,
      DEMO_MODE: saved.demo,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
