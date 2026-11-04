import test from "node:test";
import assert from "node:assert/strict";
import {
  newestActivities,
  activityFreshness,
} from "../src/core/activity-freshness";
import type { Stored, GitHubItem } from "../src/core/model";

const row = (
  id: string,
  source: string,
  collected: string,
): Stored<GitHubItem> => ({
  revision: 1,
  updatedAt: collected,
  data: {
    id,
    repository: "org/repo",
    number: 1,
    kind: "issue",
    title: id,
    body: "",
    author: "author",
    assignees: [],
    reviewers: [],
    state: "open",
    url: "https://github.com/org/repo/issues/1",
    updatedAt: source,
  },
});
test("식별자와 수집 순서에 관계없이 GitHub 변경 시각이 최신인 활동부터 보여준다", () => {
  const old = row("a-old", "2026-09-21T00:00:00Z", "2026-10-28T14:00:00+09:00"),
    latest = row(
      "z-latest",
      "2026-10-28T10:00:00+09:00",
      "2026-10-28T04:45:00Z",
    ),
    middle = row("b-middle", "2026-10-28T00:00:00Z", "2026-10-28T04:44:00Z");
  const input = [old, latest, middle];
  assert.deepEqual(
    newestActivities(input).map((r) => r.data.id),
    ["z-latest", "b-middle", "a-old"],
  );
  assert.equal(input[0], old);
  assert.deepEqual(activityFreshness(input), {
    collectedAt: old.updatedAt,
    sourceUpdatedAt: latest.data.updatedAt,
  });
});
test("활동이 없거나 시각이 잘못된 경우 현재 시각을 수집 시각으로 꾸미지 않는다", () => {
  assert.deepEqual(activityFreshness([]), {
    collectedAt: null,
    sourceUpdatedAt: null,
  });
  assert.deepEqual(activityFreshness([row("bad", "invalid", "invalid")]), {
    collectedAt: null,
    sourceUpdatedAt: null,
  });
});
