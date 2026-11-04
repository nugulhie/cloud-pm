import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stringify } from "yaml";
import {
  evaluateTask,
  parseTaskYaml,
  type TaskDefinition,
  type ResultState,
} from "../src/completion/index.js";

const makeTask = (mode: "all" | "any" = "all"): TaskDefinition => ({
  version: 1,
  task: "TASK-123",
  project: "platform",
  feature: "login",
  completion: {
    [mode]: [1, 2].map((number) => ({
      pull_request: {
        repository: "org/repo",
        number,
        state: "merged",
        target_branch: "main",
      },
    })),
  } as TaskDefinition["completion"],
});

test("문서의 YAML 예제를 읽는다", async () => {
  const task = parseTaskYaml(
    await readFile("examples/tasks/social-login.yaml", "utf8"),
  );
  assert.equal(task.feature, "social-login");
});

for (const [name, mutate] of [
  [
    "지원하지 않는 버전",
    (t: any) => {
      t.version = 2;
    },
  ],
  [
    "알 수 없는 필드",
    (t: any) => {
      t.command = "echo test";
    },
  ],
  [
    "빈 조건",
    (t: any) => {
      t.completion.all = [];
    },
  ],
  [
    "all과 any 동시 사용",
    (t: any) => {
      t.completion.any = t.completion.all;
    },
  ],
  [
    "잘못된 PR 번호",
    (t: any) => {
      t.completion.all[0].pull_request.number = -1;
    },
  ],
  [
    "잘못된 저장소 경로",
    (t: any) => {
      t.completion.all[0].pull_request.repository = "../repo";
    },
  ],
] as const) {
  test(`${name}를 거부한다`, () => {
    const task = makeTask();
    mutate(task);
    assert.throws(() => parseTaskYaml(stringify(task)));
  });
}

test("중복 키, 별칭, 여러 문서, 임의 태그, 과도한 크기를 거부한다", () => {
  const valid = stringify(makeTask());
  for (const text of [
    valid + "\nversion: 1",
    valid + "\n---\nfoo: bar",
    valid.replace("task: TASK-123", "task: !execute TASK-123"),
    valid
      .replace("task: TASK-123", "task: &id TASK-123")
      .replace("project: platform", "project: *id"),
    " ".repeat(65537),
  ])
    assert.throws(() => parseTaskYaml(text));
});

const states: ResultState[] = ["satisfied", "unsatisfied", "unknown"];
const allExpected: ResultState[][] = [
  ["satisfied", "unsatisfied", "unknown"],
  ["unsatisfied", "unsatisfied", "unsatisfied"],
  ["unknown", "unsatisfied", "unknown"],
];
const anyExpected: ResultState[][] = [
  ["satisfied", "satisfied", "satisfied"],
  ["satisfied", "unsatisfied", "unknown"],
  ["satisfied", "unknown", "unknown"],
];
for (const mode of ["all", "any"] as const) {
  for (const [i, first] of states.entries())
    for (const [j, second] of states.entries()) {
      test(`${mode}: ${first} + ${second}`, async () => {
        const result = await evaluateTask(makeTask(mode), async (_, number) => {
          const state = [first, second][number - 1];
          if (state === "unknown") throw new Error("접근 불가");
          return {
            state: state === "satisfied" ? "closed" : "open",
            mergedAt: state === "satisfied" ? "2026-10-19T01:00:00Z" : null,
            targetBranch: "main",
            observedAt: "2026-10-19T02:00:00Z",
          };
        });
        assert.equal(
          result.state,
          (mode === "all" ? allExpected : anyExpected)[i]?.[j],
        );
        assert.equal(result.conditions[0]?.state, first);
      });
    }
}

test("다른 브랜치 머지와 머지 없이 종료는 미충족이다", async () => {
  const result = await evaluateTask(makeTask(), async (_, number) => ({
    state: "closed",
    mergedAt: number === 1 ? "2026-10-19T01:00:00Z" : null,
    targetBranch: number === 1 ? "develop" : "main",
    observedAt: "2026-10-19T02:00:00Z",
  }));
  assert.equal(result.state, "unsatisfied");
  assert.deepEqual(
    result.conditions.map((c) => c.reason),
    ["머지 대상 브랜치 불일치", "머지 없이 종료"],
  );
});

test("불완전한 조회 응답은 완료 근거로 쓰지 않는다", async () => {
  const result = await evaluateTask(makeTask(), async () => ({
    state: "closed",
    mergedAt: "invalid",
    targetBranch: "main",
    observedAt: "2026-10-19T02:00:00Z",
  }));
  assert.equal(result.state, "unknown");
});
