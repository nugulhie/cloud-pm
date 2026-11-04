import test from "node:test";
import assert from "node:assert/strict";
import { parseUnifiedDiff } from "../src/core/unified-diff";

test("unified diff의 추가·삭제·문맥과 여러 hunk의 이전/이후 줄 번호", () => {
  const parsed = parseUnifiedDiff(
    "@@ -10,3 +10,4 @@ heading\n keep\n-old\n+new\n+extra\n return\n@@ -30 +31 @@\n-previous\n+next\n\\ No newline at end of file\n",
  );
  assert.deepEqual(
    parsed.lines.map((row) => [row.kind, row.oldLine, row.newLine]),
    [
      ["hunk", null, null],
      ["context", 10, 10],
      ["deleted", 11, null],
      ["added", null, 11],
      ["added", null, 12],
      ["context", 12, 13],
      ["hunk", null, null],
      ["deleted", 30, null],
      ["added", null, 31],
      ["meta", null, null],
    ],
  );
  assert.equal(parsed.lines[1]?.text, "keep");
  assert.equal(parsed.truncated, false);
});

test("전체 diff 헤더와 실제로 +/− 문자로 시작하는 코드 줄을 구분한다", () => {
  const rows = parseUnifiedDiff(
    "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n--- previous\n+++ current",
  ).lines;
  assert.deepEqual(
    rows.map((row) => row.kind),
    ["meta", "meta", "meta", "hunk", "deleted", "added"],
  );
  assert.equal(rows[4]?.text, "-- previous");
  assert.equal(rows[5]?.text, "++ current");
});

test("새 파일·삭제 파일·CRLF와 불완전한 hunk는 줄 번호를 꾸며내지 않는다", () => {
  assert.equal(
    parseUnifiedDiff("@@ -0,0 +1,1 @@\r\n+first\r\n").lines[1]?.newLine,
    1,
  );
  assert.equal(parseUnifiedDiff("@@ -1 +0,0 @@\n-last").lines[1]?.oldLine, 1);
  const unknown = parseUnifiedDiff("@@ unknown\n+hello");
  assert.equal(unknown.lines[1]?.kind, "added");
  assert.equal(unknown.lines[1]?.newLine, null);
});

test("표시 제한은 마지막 개행을 가짜 줄로 세지 않고 넘치는 패치만 표시를 제한한다", () => {
  assert.equal(parseUnifiedDiff("@@ -0,0 +1 @@\n+hello\n", 2).truncated, false);
  const bounded = parseUnifiedDiff("@@ -0,0 +1,2 @@\n+hello\n+world\n", 2);
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.lines.length, 2);
  assert.deepEqual(parseUnifiedDiff("").lines, []);
});
