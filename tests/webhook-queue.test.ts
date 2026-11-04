import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { Store } from "../src/db/store";
import { SyncQueue } from "../src/jobs/queue";
import { processNextJob } from "../src/jobs/worker";
import { receiveGithubWebhook, verifySignature } from "../src/webhooks/github";
import { acquireSyncLease } from "../src/jobs/lease";
import { DomainError } from "../src/core/model";

const secret = "unit-test-webhook-secret";
const payload = {
  repository: { full_name: "Org/Backend" },
  action: "opened",
  title: "한국어 작업",
};
function request(
  body: unknown = payload,
  options: { id?: string; signature?: string; event?: string } = {},
) {
  const text = JSON.stringify(body);
  return new Request("http://localhost/api/webhooks/github", {
    method: "POST",
    headers: {
      "x-github-delivery": options.id ?? randomUUID(),
      "x-github-event": options.event ?? "pull_request",
      "x-hub-signature-256":
        options.signature ??
        `sha256=${createHmac("sha256", secret).update(text).digest("hex")}`,
    },
    body: text,
  });
}
const settings = { secret, organization: "org" };

test("GitHub 공식 HMAC 예제와 변조 검증", () => {
  const text = Buffer.from("Hello, World!");
  const sig =
    "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";
  assert.ok(verifySignature(text, sig, "It's a Secret to Everybody"));
  assert.ok(
    !verifySignature(Buffer.from("changed"), sig, "It's a Secret to Everybody"),
  );
  assert.ok(!verifySignature(text, "sha256=bad", secret));
  assert.ok(!verifySignature(text, null, secret));
});

test("웹훅과 영속 작업 큐 통합", async (t) => {
  const store = new Store(process.env.TEST_DATABASE_URL);
  const queue = new SyncQueue(store);
  try {
    await t.test(
      "서명·조직·설정·크기 검증 실패는 큐에 저장하지 않는다",
      async () => {
        await assert.rejects(
          receiveGithubWebhook(
            request(payload, { signature: "sha256=" + "0".repeat(64) }),
            queue,
            settings,
          ),
          (e) => e instanceof DomainError && e.status === 401,
        );
        await assert.rejects(
          receiveGithubWebhook(
            request({ repository: { full_name: "other/repo" } }),
            queue,
            settings,
          ),
          (e) => e instanceof DomainError && e.status === 403,
        );
        await assert.rejects(
          receiveGithubWebhook(request(), queue, {}),
          (e) => e instanceof DomainError && e.status === 503,
        );
        await assert.rejects(
          receiveGithubWebhook(request(), queue, {
            ...settings,
            disabled: true,
          }),
          (e) => e instanceof DomainError && e.status === 403,
        );
        await assert.rejects(
          receiveGithubWebhook(
            new Request("http://localhost", {
              method: "POST",
              body: "a".repeat(1024 * 1024 + 1),
            }),
            queue,
            settings,
          ),
          (e) => e instanceof DomainError && e.status === 413,
        );
        assert.equal((await queue.list()).length, 0);
      },
    );
    await t.test(
      "ping과 지원하지 않는 이벤트는 동기화를 만들지 않는다",
      async () => {
        assert.equal(
          (
            await receiveGithubWebhook(
              request({}, { event: "ping" }),
              queue,
              settings,
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await receiveGithubWebhook(
              request({}, { event: "star" }),
              queue,
              settings,
            )
          ).body.accepted,
          false,
        );
        assert.equal((await queue.list()).length, 0);
      },
    );
    await t.test("Unicode 원문 서명 검증 및 중복 delivery 제거", async () => {
      const id = randomUUID();
      const first = await receiveGithubWebhook(
        request(payload, { id }),
        queue,
        settings,
      );
      const again = await receiveGithubWebhook(
        request(payload, { id }),
        queue,
        settings,
      );
      assert.equal(first.status, 202);
      assert.equal(first.body.duplicate, false);
      assert.equal(again.body.duplicate, true);
      assert.equal((await queue.list()).length, 1);
      assert.equal((await queue.list())[0]?.repository, "org/backend");
    });
    await t.test("작업 처리 성공과 완료된 delivery 재전송", async () => {
      const job = (await queue.list())[0]!;
      let repo = "";
      const result = await processNextJob(store, async (r) => {
        repo = r;
        return {
          id: randomUUID(),
          startedAt: "",
          finishedAt: "",
          repositories: 1,
          errors: [],
        };
      });
      assert.equal(result?.status, "completed");
      assert.equal(repo, "org/backend");
      await receiveGithubWebhook(
        request(payload, { id: job.id }),
        queue,
        settings,
      );
      assert.equal((await queue.list())[0]?.status, "completed");
      assert.equal(await queue.claim(), undefined);
    });
    await t.test(
      "실패는 지수 대기 후 재시도하고 최대 횟수 이후 수동 재시도한다",
      async () => {
        const id = randomUUID();
        await queue.enqueue(id, "issues", "org/backend");
        const result = await processNextJob(store, async () => {
          throw new Error("sensitive provider response");
        });
        assert.equal(result?.status, "pending");
        const saved = (await queue.list()).find((j) => j.id === id)!;
        assert.ok(!saved.last_error?.includes("sensitive"));
        assert.equal(await queue.claim(), undefined);
        await store.query(
          "UPDATE sync_jobs SET available_at=now()-interval '1 second',attempts=4 WHERE id=$1",
          [id],
        );
        const job = (await queue.claim())!;
        assert.equal(job.attempts, 5);
        assert.equal(await queue.finish(job, "조회 실패"), true);
        assert.equal(
          (await queue.list()).find((j) => j.id === id)?.status,
          "failed",
        );
        assert.equal(await queue.retry(id), true);
        const retry = (await queue.claim())!;
        assert.equal(retry.attempts, 1);
        await queue.finish(retry);
      },
    );
    await t.test(
      "임대 만료 작업은 복구하고 이전 작업자는 완료 처리할 수 없다",
      async () => {
        const id = randomUUID();
        await queue.enqueue(id, "push", "org/backend");
        const old = (await queue.claim())!;
        assert.equal(await queue.heartbeat(old), true);
        await store.query(
          "UPDATE sync_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
          [id],
        );
        const recovered = (await queue.claim())!;
        assert.notEqual(recovered.lease_token, old.lease_token);
        assert.equal(recovered.attempts, 2);
        assert.equal(await queue.finish(old), false);
        assert.equal(await queue.heartbeat(old), false);
        assert.equal(await queue.finish(recovered), true);
      },
    );
    await t.test("동시 claim은 다른 작업을 가져간다", async () => {
      await queue.enqueue(randomUUID(), "push", "org/one");
      await queue.enqueue(randomUUID(), "push", "org/two");
      const [a, b] = await Promise.all([queue.claim(), queue.claim()]);
      assert.ok(a && b);
      assert.notEqual(a.id, b.id);
      await queue.finish(a);
      await queue.finish(b);
    });
    await t.test(
      "마지막 시도에서 작업자가 종료되면 실패 상태로 이동한다",
      async () => {
        const id = randomUUID();
        await queue.enqueue(id, "push", "org/backend");
        const job = (await queue.claim())!;
        await store.query(
          "UPDATE sync_jobs SET attempts=5,lease_expires_at=now()-interval '1 second' WHERE id=$1",
          [id],
        );
        assert.equal(await queue.claim(), undefined);
        assert.equal(
          (await queue.list()).find((j) => j.id === id)?.status,
          "failed",
        );
        assert.equal(await queue.finish(job), false);
      },
    );
    await t.test(
      "전역 동기화 임대도 만료 후 복구하며 예전 임대는 해제할 수 없다",
      async () => {
        const old = await acquireSyncLease(store);
        await assert.rejects(
          acquireSyncLease(store),
          (e) => e instanceof DomainError && e.status === 409,
        );
        await store.query(
          "UPDATE sync_leases SET expires_at=now()-interval '1 second'",
        );
        const recovered = await acquireSyncLease(store);
        await assert.rejects(old.check());
        await old.close();
        await recovered.check();
        await recovered.close();
        assert.equal(
          (await store.query("SELECT * FROM sync_leases")).length,
          0,
        );
      },
    );
  } finally {
    await store.close();
  }
});
