import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { POST as webhook } from "../src/app/api/webhooks/github/route";
import { GET, POST as api } from "../src/app/api/[...path]/route";
import { Store } from "../src/db/store";
import { SyncQueue } from "../src/jobs/queue";

test("HTTP 웹훅 저장과 조회·수정 토큰별 작업 큐 권한", async () => {
  const names = [
    "GITHUB_WEBHOOK_SECRET",
    "GITHUB_ORG",
    "DEMO_MODE",
    "APP_READ_TOKEN",
    "APP_WRITE_TOKEN",
    "APP_URL",
  ] as const;
  const old = Object.fromEntries(names.map((key) => [key, process.env[key]]));
  process.env.GITHUB_WEBHOOK_SECRET = "http-test-secret";
  process.env.GITHUB_ORG = "org";
  delete process.env.DEMO_MODE;
  process.env.APP_READ_TOKEN = "reader";
  process.env.APP_WRITE_TOKEN = "editor";
  process.env.APP_URL = "http://localhost";
  const global = globalThis as typeof globalThis & { pmStore?: Store };
  const previous = global.pmStore;
  const store = new Store();
  global.pmStore = store;
  try {
    const id = randomUUID();
    const body = JSON.stringify({ repository: { full_name: "org/backend" } });
    const makeRequest = (signature: string) =>
      new Request("http://localhost/api/webhooks/github", {
        method: "POST",
        body,
        headers: {
          "x-github-delivery": id,
          "x-github-event": "issues",
          "x-hub-signature-256": signature,
        },
      });
    const sig = `sha256=${createHmac("sha256", "http-test-secret").update(body).digest("hex")}`;
    assert.equal(
      (await webhook(makeRequest("sha256=" + "0".repeat(64)))).status,
      401,
    );
    const response = await webhook(makeRequest(sig));
    assert.equal(response.status, 202);
    assert.equal((await response.json()).duplicate, false);
    assert.equal(
      (await (await webhook(makeRequest(sig))).json()).duplicate,
      true,
    );
    const ctx = { params: Promise.resolve({ path: ["jobs"] }) };
    assert.equal(
      (await GET(new Request("http://localhost/api/jobs"), ctx)).status,
      401,
    );
    const read = await GET(
      new Request("http://localhost/api/jobs", {
        headers: { authorization: "Bearer reader" },
      }),
      ctx,
    );
    assert.equal(read.status, 200);
    assert.equal((await read.json()).length, 1);
    const queue = new SyncQueue(store);
    const job = (await queue.claim())!;
    await store.query("UPDATE sync_jobs SET attempts=5 WHERE id=$1", [id]);
    await queue.finish({ ...job, attempts: 5 }, "실패");
    const retry = (token: string) =>
      api(
        new Request("http://localhost/api/jobs/retry", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ id }),
        }),
        { params: Promise.resolve({ path: ["jobs", "retry"] }) },
      );
    assert.equal((await retry("reader")).status, 403);
    assert.equal((await retry("editor")).status, 200);
    assert.equal((await queue.list())[0]?.status, "pending");
  } finally {
    await store.close();
    global.pmStore = previous;
    for (const key of names) {
      const value = old[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
