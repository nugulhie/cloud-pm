import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../src/app/api/[...path]/route";
import { Store } from "../src/db/store";
import { knowledgeInput } from "../src/core/knowledge-model";

test("영향 조회 HTTP 계약: 인증·읽기 토큰·no-store·입력 오류·404와 원본 보존", async () => {
  const names = ["DEMO_MODE", "APP_READ_TOKEN", "APP_WRITE_TOKEN"] as const;
  const old = Object.fromEntries(names.map((key) => [key, process.env[key]]));
  delete process.env.DEMO_MODE;
  process.env.APP_READ_TOKEN = "impact-test-reader";
  process.env.APP_WRITE_TOKEN = "impact-test-writer";
  const global = globalThis as typeof globalThis & { pmStore?: Store };
  const previous = global.pmStore,
    store = new Store();
  global.pmStore = store;
  try {
    const document = {
      ...knowledgeInput.parse({
        id: "policy",
        kind: "policy",
        name: "기준",
        content: "원문",
      }),
      editor: "pm",
    };
    await store.save("knowledge", "policy", document, "pm");
    const context = {
      params: Promise.resolve({ path: ["knowledge", "impact"] }),
    };
    const get = (query: string, token = "impact-test-reader") =>
      GET(
        new Request(`http://localhost/api/knowledge/impact?${query}`, {
          headers: token ? { authorization: `Bearer ${token}` } : {},
        }),
        context,
      );
    assert.equal((await get("id=policy", "")).status, 401);
    assert.equal((await get("id=policy", "wrong-token")).status, 401);
    const response = await get("id=policy");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const body = await response.json();
    assert.equal(body.document.revision, 1);
    assert.equal(body.page.total, 0);
    assert.equal(body.page.nextOffset, null);
    for (const query of [
      "",
      "id=policy&limit=101",
      "id=policy&kind=all",
      "id=policy&offset=-1",
      "id=policy&extra=unsupported",
      "id=policy&scope=both",
    ])
      assert.equal((await get(query)).status, 400, query);
    assert.equal((await get("id=missing")).status, 404);
    assert.equal((await get("id=policy&project=missing")).status, 404);
    assert.deepEqual((await store.get("knowledge", "policy"))!.data, document);
    assert.equal(
      (
        await store.query<{ n: number }>("SELECT count(*)::int n FROM events")
      )[0]!.n,
      1,
    );
    await store.save(
      "knowledge",
      "child",
      { ...document, id: "child", name: "하위 정책", dependsOn: ["policy"] },
      "pm",
    );
    await store.save(
      "project",
      "p",
      {
        id: "p",
        name: "제품",
        goal: "",
        featurePrefix: "ABCDE",
        repositories: [],
      },
      "pm",
    );
    await store.save(
      "requirement",
      "r",
      {
        id: "r",
        project: "p",
        number: 1,
        featureName: "연결 PRD",
        status: "draft",
        policyIds: ["child"],
      },
      "pm",
    );
    const indirect = await (await get("id=policy")).json();
    assert.equal(indirect.summary.requirements, 1);
    assert.equal(indirect.summary.policies, 1);
    assert.equal(indirect.page.items[0].references[0].policyDistance, 1);
    assert.equal(
      (await (await get("id=policy&scope=direct")).json()).page.total,
      0,
    );
    assert.equal(
      (await (await get("id=policy&kind=policies")).json()).page.items[0].id,
      "child",
    );
  } finally {
    global.pmStore = previous;
    await store.close();
    for (const key of names) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
  }
});
