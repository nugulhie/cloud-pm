import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/db/store";
import { Users } from "../src/users/service";
import { tokenHash } from "../src/users/crypto";
test("워크스페이스 소유자·초대 대상·일회성·만료·취소 및 조직 권한", async () => {
  const keys = [
      "TOKEN_ENCRYPTION_KEY",
      "GITHUB_ORG",
      "APP_URL",
      "DEMO_MODE",
    ] as const,
    saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.TOKEN_ENCRYPTION_KEY = "77".repeat(32);
  process.env.GITHUB_ORG = "org";
  process.env.APP_URL = "http://localhost";
  delete process.env.DEMO_MODE;
  const store = new Store();
  let denied = false;
  const users = new Users(store, async (input, init) => {
    const path = new URL(String(input)).pathname;
    const login =
      new Headers(init?.headers).get("authorization")?.replace("Bearer ", "") ??
      "";
    if (denied) return new Response("", { status: 403 });
    if (path === "/user") return Response.json({ login, name: login });
    if (path.includes("/memberships/"))
      return Response.json({ state: "active", role: "member" });
    return Response.json([{ full_name: "org/repo" }]);
  });
  const request = (token: string) =>
    new Request("http://localhost/api/auth/workspace", {
      headers: { cookie: `pm_session=${token}` },
    });
  const register = (login: string, inviteToken?: string) =>
    users.register({
      githubToken: login,
      password: "long-test-password",
      ...(inviteToken ? { inviteToken } : {}),
    });
  const token = (url: string) =>
    new URLSearchParams(new URL(url).hash.slice(1)).get("invite")!;
  try {
    const owner = await register("owner"),
      ownerReq = request(owner.token);
    assert.equal((await users.workspace(ownerReq)).admin, true);
    const member = await register("member"),
      memberReq = request(member.token);
    assert.equal((await users.workspace(memberReq)).admin, false);
    await assert.rejects(users.createInvite(memberReq, {}));
    await assert.rejects(
      users.updateWorkspace(memberReq, { inviteOnly: true }),
    );
    await users.updateWorkspace(ownerReq, { inviteOnly: true });
    await assert.rejects(register("uninvited"));
    assert.equal((await users.workspace(ownerReq)).inviteOnly, true);
    const invite = await users.createInvite(ownerReq, { login: "bob" });
    const secret = token(invite.url);
    const stored = (
      await store.query<{ token_hash: string }>(
        "SELECT token_hash FROM workspace_invites WHERE id=$1",
        [invite.id],
      )
    )[0]!;
    assert.equal(stored.token_hash, tokenHash(secret));
    assert.ok(
      !JSON.stringify(await users.workspace(ownerReq)).includes(secret),
    );
    await assert.rejects(register("wrong", secret));
    const bob = await register("bob", secret);
    assert.equal(bob.user.login, "bob");
    await assert.rejects(register("bob", secret));
    const accepted = (await users.workspace(ownerReq)).invites as {
      status: string;
      id: string;
    }[];
    assert.equal(accepted.find((i) => i.id === invite.id)?.status, "accepted");
    const expired = await users.createInvite(ownerReq, {});
    await store.query(
      "UPDATE workspace_invites SET expires_at=now()-interval '1 second' WHERE id=$1",
      [expired.id],
    );
    await assert.rejects(register("expired", token(expired.url)));
    const revoked = await users.createInvite(ownerReq, {});
    await users.revokeInvite(ownerReq, { id: revoked.id });
    await assert.rejects(register("revoked", token(revoked.url)));
    const outside = await users.createInvite(ownerReq, {});
    denied = true;
    await assert.rejects(register("outside", token(outside.url)));
    denied = false;
    const api = await users.rotateApiToken(ownerReq, "write");
    await assert.rejects(
      users.createInvite(
        new Request("http://localhost/api/auth/invites", {
          headers: { authorization: `Bearer ${api.token}` },
        }),
        {},
      ),
    );
  } finally {
    await store.close();
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});
