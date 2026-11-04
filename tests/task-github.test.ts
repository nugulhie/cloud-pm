import assert from "node:assert/strict";
import test from "node:test";
import { taskGitHubConnections } from "../src/core/task-github";
import type { Stored, GitHubItem } from "../src/core/model";
import type { Link } from "../src/core/service";

test("태스크의 승인 연결만 표시하며 누락·권한 밖 캐시와 중복을 제외한다", () => {
  const items = [75, 76, 77].map(
    (number) =>
      ({
        data: { id: `org/app#${number}`, number, kind: "issue" },
      }) as Stored<GitHubItem>,
  );
  const link = (task: string, number: number, status: Link["status"]) =>
    ({
      data: {
        id: `${task}:${number}`,
        task,
        item: `org/app#${number}`,
        status,
      },
    }) as Stored<Link>;
  const result = taskGitHubConnections(
    [
      link("task-a", 75, "approved"),
      link("task-a", 75, "approved"),
      link("task-a", 76, "suggested"),
      link("task-a", 77, "rejected"),
      link("task-a", 99, "approved"),
      link("task-b", 76, "approved"),
    ],
    items,
  );
  assert.deepEqual(
    result.get("task-a")?.map((i) => i.id),
    ["org/app#75"],
  );
  assert.deepEqual(
    result.get("task-b")?.map((i) => i.id),
    ["org/app#76"],
  );
});
