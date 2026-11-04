import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MarkdownBody, { markdownUrl } from "../src/components/markdown-body";

test("GFM 제목·표·체크리스트·코드와 안전한 HTML 렌더링", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownBody, {
      repository: "org/repo",
      body: "# 제목\n\n|항목|상태|\n|---|---|\n|API|완료|\n\n- [x] 구현\n- [ ] 리뷰\n\n```ts\nconst ready = true;\n```\n\n<details><summary>상세 설명</summary>내용</details>",
    }),
  );
  assert.ok(html.includes("<h1>제목</h1>"));
  assert.ok(html.includes("<table>"));
  assert.ok(html.includes('type="checkbox"'));
  assert.ok(html.includes("<pre>"));
  assert.ok(html.includes("<summary>상세 설명</summary>"));
});
test("스크립트·이벤트 핸들러·위험한 링크를 제거한다", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownBody, {
      repository: "org/repo",
      body: '<script>alert(1)</script><img src="x" onerror="alert(1)">\n\n[위험](javascript:alert(1))',
    }),
  );
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("onerror"));
  assert.ok(!html.includes("javascript:"));
  assert.equal(markdownUrl("javascript:alert(1)", "org/repo"), "");
  assert.equal(
    markdownUrl("./README.md", "org/repo"),
    "https://github.com/org/repo/blob/HEAD/README.md",
  );
});
