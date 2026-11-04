import assert from "node:assert/strict";
import test from "node:test";
import { createId } from "../src/core/browser-id";

test("내부 IP HTTP처럼 randomUUID가 없어도 UUID v4 식별자를 생성한다", () => {
  const source = { getRandomValues: crypto.getRandomValues.bind(crypto) };
  const ids = Array.from({ length: 100 }, () => createId(source));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids)
    assert.match(
      id,
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
});

test("지원하는 환경에서는 네이티브 randomUUID를 사용한다", () => {
  const expected = "12345678-1234-4234-8234-123456789abc";
  assert.equal(
    createId({
      randomUUID: () => expected,
      getRandomValues: () => {
        throw new Error("사용하지 않아야 함");
      },
    }),
    expected,
  );
});
