import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/db/store";
import { Users } from "../src/users/service";
test("소유자 본인 확인 후 계정 복구 코드는 한 번만 사용되고 기존 세션은 해제된다", async () => {
  const old = process.env.DEMO_MODE;
  delete process.env.DEMO_MODE;
  const store = new Store(),
    users = new Users(store),
    request = (token: string) =>
      new Request("http://localhost/api/auth/workspace", {
        headers: { cookie: `pm_session=${token}` },
      });
  try {
    const owner = await users.register({
        login: "owner",
        displayName: "소유자",
        password: "long-test-password",
      }),
      member = await users.register({
        login: "member",
        displayName: "멤버",
        password: "long-test-password",
      });
    await assert.rejects(
      users.issueRecovery(request(member.token), {
        userId: owner.user.id,
        currentPassword: "long-test-password",
      }),
    );
    await assert.rejects(
      users.issueRecovery(request(owner.token), {
        userId: member.user.id,
        currentPassword: "wrong",
      }),
    );
    const issued = await users.issueRecovery(request(owner.token), {
      userId: member.user.id,
      currentPassword: "long-test-password",
    });
    await users.recoverPassword({
      token: issued.token,
      newPassword: "new-test-password",
    });
    await assert.rejects(users.profile(request(member.token)));
    await assert.rejects(
      users.recoverPassword({
        token: issued.token,
        newPassword: "third-test-password",
      }),
    );
    const fresh = await users.login({
      login: "member",
      password: "new-test-password",
    });
    assert.equal(fresh.user.id, member.user.id);
    await users.transferOwnership(request(owner.token), {
      userId: member.user.id,
      expectedOwnerId: owner.user.id,
      currentPassword: "long-test-password",
    });
    assert.equal(
      (await users.workspace(request(fresh.token))).ownerId,
      member.user.id,
    );
    await assert.rejects(
      users.issueRecovery(request(owner.token), {
        userId: member.user.id,
        currentPassword: "long-test-password",
      }),
    );
  } finally {
    await store.close();
    if (old === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = old;
  }
});
