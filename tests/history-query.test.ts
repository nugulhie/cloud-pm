import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/db/store";
import { changeHistory, changeHistoryQuery } from "../src/core/history";

const visible = { projects: [], tasks: [], items: [] };

test("최신 300개 이력에서도 조회 범위 밖의 직전 버전과 Markdown 원문을 보존한다", async () => {
  const store = new Store();
  try {
    await store.query(`INSERT INTO events(id,workspace_id,kind,entity_id,actor,data,created_at)
      SELECT 'task-event-'||lpad(n::text,4,'0'),'main','task','task-a','planner',
        jsonb_build_object('revision',n,'value',jsonb_build_object('id','task-a','title','제목 '||n,'description','## 본문 '||n,'project','p')),
        '2026-01-01'::timestamptz+n*interval '1 second' FROM generate_series(1,401) n`);
    await store.query(`INSERT INTO events(id,workspace_id,kind,entity_id,actor,data,created_at)
      SELECT 'internal-'||n,'main','repository','repo-'||n,'worker','{}'::jsonb,
        '2027-01-01'::timestamptz FROM generate_series(1,310) n`);
    const rows = await store.query<{
      value: { title: string };
      previous: { title: string };
    }>(changeHistoryQuery, ["main"]);
    assert.equal(rows.length, 300);
    assert.equal(rows.at(-1)!.value.title, "제목 102");
    assert.equal(rows.at(-1)!.previous.title, "제목 101");
    const history = await changeHistory(
      store,
      { name: "planner", role: "read" },
      visible,
    );
    assert.equal(history.length, 100);
    const oldest = history.at(-1)!;
    assert.equal(oldest.action, "updated");
    assert.deepEqual(
      oldest.changes.find((change) => change.field === "제목"),
      { field: "제목", before: "제목 301", after: "제목 302", markdown: false },
    );
    assert.deepEqual(
      history[0]!.changes.find((change) => change.field === "설명"),
      {
        field: "설명",
        before: "## 본문 400",
        after: "## 본문 401",
        markdown: true,
      },
    );
  } finally {
    await store.close();
  }
});

test("GitHub 대형 diff는 이력 응답에서 제외하고 파일 수·커밋·본문 변경을 표시한다", async () => {
  const store = new Store();
  try {
    await store.query(`INSERT INTO events(id,workspace_id,kind,entity_id,actor,data,created_at)
      SELECT 'github-'||n,'main','github','org/repo#1','webhook-worker',
        jsonb_build_object('revision',n,'value',jsonb_build_object(
          'id','org/repo#1','repository','org/repo','title','대형 PR','body','## 변경 '||n,
          'headSha',lpad(n::text,40,'0'),
          'files',(SELECT jsonb_agg(jsonb_build_object('path','src/file-'||f||'.ts','patch',repeat('PATCH_MUST_STAY_OUT',8000))) FROM generate_series(1,n) f))),
        '2026-01-01'::timestamptz+n*interval '1 second' FROM generate_series(1,3) n`);
    const rows = await store.query<{
      value: { files: number };
      previous: { files: number } | null;
    }>(changeHistoryQuery, ["main"]);
    assert.equal(rows[0]!.value.files, 3);
    assert.equal(rows[0]!.previous?.files, 2);
    assert.ok(!JSON.stringify(rows).includes("PATCH_MUST_STAY_OUT"));
    const history = await changeHistory(
      store,
      { name: "reader", role: "read" },
      visible,
    );
    assert.equal(
      history[0]!.changes.find((change) => change.field === "변경 파일")
        ?.before,
      "2개 파일",
    );
    assert.equal(
      history[0]!.changes.find((change) => change.field === "변경 파일")?.after,
      "3개 파일",
    );
    assert.equal(
      history[0]!.changes.find((change) => change.field === "본문")?.after,
      "## 변경 3",
    );
    assert.ok(history[0]!.changes.some((change) => change.field === "PR 커밋"));
    assert.equal(history.at(-1)!.action, "created");
  } finally {
    await store.close();
  }
});

test("같은 식별자의 다른 워크스페이스 버전을 이전 값으로 섞지 않는다", async () => {
  const store = new Store();
  try {
    await store.query(`INSERT INTO events(id,workspace_id,kind,entity_id,actor,data,created_at) VALUES
      ('a','main','task','same','planner','{"revision":1,"value":{"title":"공개"}}','2026-01-01'),
      ('b','other','task','same','planner','{"revision":2,"value":{"title":"비공개"}}','2026-01-02'),
      ('c','main','task','same','planner','{"revision":3,"value":{"title":"공개 수정"}}','2026-01-03')`);
    const history = await changeHistory(
      store,
      { name: "reader", role: "read" },
      visible,
    );
    assert.equal(
      history[0]!.changes.find((change) => change.field === "제목")?.before,
      "공개",
    );
    assert.ok(!JSON.stringify(history).includes("비공개"));
    const other = await changeHistory(
      store.forWorkspace("other"),
      { name: "reader", role: "read" },
      visible,
    );
    assert.equal(other.length, 1);
    assert.equal(other[0]!.action, "created");
  } finally {
    await store.close();
  }
});
