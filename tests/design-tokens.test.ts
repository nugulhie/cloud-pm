import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// DESIGN.md's One Source Rule and Weight Not Size Rule only hold if something
// checks them. A design pass can fix every value by hand and the next one will
// quietly add new ones, so the rules live here as a ratchet: the counts may
// fall, never rise.
const sheets = ["src/app/globals.css", "src/app/soldoc-theme.css"] as const;
const read = (name: string) =>
  readFileSync(resolve(process.cwd(), name), "utf8");

// The six steps of DESIGN.md's hierarchy, plus the three documented
// exceptions that are not reading text: icon glyphs, the brand lockup, and
// the 16px form inputs that stop iOS Safari zooming on focus.
const typeSteps = new Set([12, 14, 15, 18, 21, 29]);
const glyphSteps = new Set([16, 20, 22, 23, 25, 26]);
const sizes = (name: string) =>
  read(name)
    .split("\n")
    .flatMap((line, index) => {
      const match = /font-size:\s*(\d+)px/.exec(line);
      return match
        ? [{ at: `${name}:${index + 1}`, size: Number(match[1]) }]
        : [];
    });

test("글자 크기는 DESIGN.md의 여섯 단계와 문서화된 예외만 쓴다", () => {
  const offScale = sheets
    .flatMap(sizes)
    .filter(({ size }) => !typeSteps.has(size) && !glyphSteps.has(size))
    .map(({ at, size }) => `${at} ${size}px`);
  assert.deepEqual(
    offScale,
    [],
    `타입 스케일 밖의 글자 크기입니다. DESIGN.md의 단계(12·14·15·18·21·29)를 쓰거나, 글자가 아니라면 DESIGN.md의 예외에 근거를 적으세요:\n${offScale.join("\n")}`,
  );
});

test("12px보다 작은 글자는 없다", () => {
  const small = sheets
    .flatMap(sizes)
    .filter(({ size }) => size < 12)
    .map(({ at, size }) => `${at} ${size}px`);
  assert.deepEqual(small, [], `The 12px Floor Rule 위반:\n${small.join("\n")}`);
});

// A hex literal outside :root is a colour the design system does not know
// about. There are still many, so this holds the line rather than drawing it:
// lower the baseline when you remove some, and never raise it.
const hexBaseline: Record<string, number> = {
  "src/app/globals.css": 260,
  "src/app/soldoc-theme.css": 130,
};

test("토큰 블록 밖의 hex 색상 수는 늘지 않는다", () => {
  for (const name of sheets) {
    const text = read(name);
    const root = /:root\s*\{[^}]*\}/.exec(text);
    const outside = root
      ? text.slice(0, root.index) + text.slice(root.index + root[0].length)
      : text;
    const count = (outside.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length;
    const allowed = hexBaseline[name]!;
    assert.ok(
      count <= allowed,
      `${name}: 토큰 밖 hex가 ${count}개로 기준 ${allowed}개를 넘었습니다. 새 색은 :root의 토큰으로 추가하고 var()로 쓰세요.`,
    );
    assert.ok(
      count >= allowed - 20,
      `${name}: 토큰 밖 hex가 ${count}개로 줄었습니다. tests/design-tokens.test.ts의 기준을 ${count}로 낮춰 주세요.`,
    );
  }
});

test("색 토큰과 포커스 링은 한 곳에서만 정의한다", () => {
  const roots = sheets.flatMap((name) =>
    (read(name).match(/:root\s*\{/g) ?? []).map(() => name),
  );
  assert.deepEqual(
    roots,
    ["src/app/globals.css"],
    `:root 블록은 globals.css에 하나만 있어야 합니다 (The One Source Rule). 발견: ${roots.join(", ")}`,
  );
  assert.ok(
    !/--focus-ring:/.test(read("src/app/soldoc-theme.css")),
    "포커스 링 토큰을 테마에서 다시 정의하지 마세요.",
  );
});
