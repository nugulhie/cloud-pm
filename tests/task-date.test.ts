import test from "node:test";
import assert from "node:assert/strict";
import { taskToday, taskIsOverdue } from "../src/core/task-date";

test("한국 자정에 기한 초과로 바뀌고 완료·취소 작업은 제외한다", () => {
  const before = new Date("2026-10-29T23:59:59+09:00"),
    after = new Date("2026-10-30T00:00:00+09:00");
  assert.equal(taskToday(before), "2026-10-29");
  assert.equal(taskToday(after), "2026-10-30");
  assert.equal(
    taskIsOverdue({ dueDate: "2026-10-29", status: "ready" }, before),
    false,
  );
  assert.equal(
    taskIsOverdue({ dueDate: "2026-10-29", status: "ready" }, after),
    true,
  );
  for (const status of ["done", "canceled"] as const)
    assert.equal(
      taskIsOverdue({ dueDate: "2026-10-29", status }, after),
      false,
    );
  assert.equal(taskIsOverdue({ dueDate: null, status: "ready" }, after), false);
});
