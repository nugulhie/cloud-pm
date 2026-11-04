import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/db/store";
test("기존 단일 워크스페이스 DB의 식별자·이력을 보존하고 복합 키를 이전한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cloud-pm-migration-"));
  let store = new Store(undefined, join(directory, "db"));
  try {
    await store.save(
      "project",
      "existing",
      { id: "existing", name: "기존 프로젝트" },
      "owner",
    );
    await store.query("ALTER TABLE records DROP CONSTRAINT records_pkey");
    await store.query("ALTER TABLE records DROP COLUMN workspace_id");
    await store.query("ALTER TABLE records ADD PRIMARY KEY(kind,id)");
    await store.query("ALTER TABLE events DROP COLUMN workspace_id");
    await store.close();
    store = new Store(undefined, join(directory, "db"));
    assert.equal(
      (await store.get<{ name: string }>("project", "existing"))?.data.name,
      "기존 프로젝트",
    );
    assert.equal((await store.history()).length, 1);
    const scoped = store.forWorkspace("another");
    await scoped.save(
      "project",
      "existing",
      { id: "existing", name: "별도 프로젝트" },
      "other",
    );
    assert.equal(
      (await store.get<{ name: string }>("project", "existing"))?.data.name,
      "기존 프로젝트",
    );
    assert.equal(
      (await scoped.get<{ name: string }>("project", "existing"))?.data.name,
      "별도 프로젝트",
    );
    assert.equal((await store.history()).length, 1);
    assert.equal((await scoped.history()).length, 1);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
