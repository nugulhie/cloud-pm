import assert from "node:assert/strict";
import test from "node:test";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
import { DomainError, type Task } from "../src/core/model";
import { parseRequirementCsv } from "../src/core/requirement-csv";
import type { Requirement } from "../src/core/requirement-model";

const file = {
  project: "product",
  fileName: "PRD_all.csv",
  csv: '\uFEFF정책,ID,기능명,비고,상세 설명,최종 편집 일시,최종 편집자\r\n"권한: ""관리자"", 초대",TCO-1,초대 기능,참고 링크,"첫 줄\r\n둘째 줄",2026년 10월 23일 오후 2:13,기획자\r\n,TCO-2,가입 기능,,설명,2026년 10월 1일 오전 12:00,작성자\r\n',
};
const editable = ({
  number,
  editor,
  taskId,
  taskIds,
  featureId,
  source,
  ...data
}: Requirement) => data;
const conflict = (error: unknown) =>
  error instanceof DomainError && error.status === 409;

test("Notion CSV의 BOM·열 순서·쉼표·인용·줄바꿈·한국어 날짜를 보존한다", () => {
  const parsed = parseRequirementCsv(file);
  assert.equal(parsed.rows.length, 2);
  const first = parsed.rows[0]!;
  assert.deepEqual(first.errors, []);
  assert.equal(first.data.sourceId, "TCO-1");
  assert.equal(first.data.description, "첫 줄\n둘째 줄");
  assert.equal(first.data.policy, '권한: "관리자", 초대');
  assert.equal(first.source.editor, "기획자");
  assert.equal(first.source.editedAt, "2026-10-23T05:13:00.000Z");
  assert.equal(parsed.rows[1]!.source.editedAt, "2026-09-30T15:00:00.000Z");
});
test("CSV의 중복 ID·잘못된 날짜·필수 값·열 개수 오류를 행별로 알린다", () => {
  const parsed = parseRequirementCsv({
    ...file,
    csv: "ID,기능명,최종 편집 일시\nA,,2026년 2월 30일 오후 1:00\na,기능\n",
  });
  assert.equal(parsed.rows.length, 2);
  assert.ok(parsed.rows[0]!.errors.some((e) => e.includes("기능명")));
  assert.ok(parsed.rows[0]!.errors.some((e) => e.includes("날짜")));
  assert.ok(parsed.rows[1]!.errors.some((e) => e.includes("열 개수")));
  assert.ok(parsed.rows.every((r) => r.errors.some((e) => e.includes("중복"))));
  for (const csv of [
    "설명\n값",
    'ID,기능명\nA,"닫히지 않은 값',
    "ID,번호,기능명\nA,A,기능",
  ])
    assert.throws(() => parseRequirementCsv({ ...file, csv }));
});
test("빈 줄은 무시하고 상태·담당자와 정규화된 헤더를 매핑한다", () => {
  const parsed = parseRequirementCsv({
    ...file,
    csv: "넘버링,기능명,상세설명,상태,담당자,무시할열\n\nA,기능,설명,진행 중,담당,비공개\n\n",
  });
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]!.data.status, "in_progress");
  assert.equal(parsed.rows[0]!.data.assignee, "담당");
  assert.equal(parsed.warnings.length, 1);
  assert.throws(
    () =>
      parseRequirementCsv({
        ...file,
        csv:
          "ID,기능명\n" +
          Array.from({ length: 501 }, (_, i) => `ID-${i},기능`).join("\n"),
      }),
    /500/,
  );
  assert.throws(
    () =>
      parseRequirementCsv({
        ...file,
        csv: "ID,기능명\nA," + "가".repeat(350000),
      }),
    (error) => error instanceof DomainError && error.status === 413,
  );
});

test("CSV 일괄 가져오기의 접근·감사·중복·수정 충돌·태스크 연결", async (t) => {
  const store = new Store(),
    service = new Service(store, { name: "importing-pm", role: "write" });
  try {
    await service.saveProject({
      id: "product",
      name: "프로젝트",
      goal: "",
      repositories: ["org/app"],
    });
    await service.saveProject({
      id: "other",
      name: "다른 프로젝트",
      goal: "",
      repositories: ["org/private"],
    });
    await t.test(
      "미리보기는 저장하지 않고 실제 가져오기는 원본 ID·편집 정보를 보존한다",
      async () => {
        const preview = await service.previewRequirementCsv(file);
        assert.equal(preview.counts.new, 2);
        assert.equal((await service.dashboard()).requirements.length, 0);
        assert.deepEqual(
          await service.importRequirementCsv({
            ...file,
            mode: "skip",
            previewHash: preview.previewHash,
          }),
          { created: 2, updated: 0, skipped: 0 },
        );
        const rows = (await service.dashboard()).requirements;
        const row = rows.find((r) => r.data.sourceId === "TCO-1")!;
        assert.equal(row.data.editor, "importing-pm");
        assert.equal(row.data.source?.editor, "기획자");
        assert.equal(row.data.source?.editedAt, "2026-10-23T05:13:00.000Z");
        assert.equal(row.data.description, "첫 줄\n둘째 줄");
        assert.equal(row.data.number, 1);
      },
    );
    await t.test(
      "같은 파일은 중복 생성 없이 건너뛰며, 프로젝트가 다르면 별도로 가져온다",
      async () => {
        const preview = await service.previewRequirementCsv(file);
        assert.equal(preview.counts.existing, 2);
        assert.deepEqual(
          await service.importRequirementCsv({
            ...file,
            mode: "skip",
            previewHash: preview.previewHash,
          }),
          { created: 0, updated: 0, skipped: 2 },
        );
        assert.equal((await service.dashboard()).requirements.length, 2);
        const other = { ...file, project: "other" };
        const otherPreview = await service.previewRequirementCsv(other);
        assert.equal(otherPreview.counts.new, 2);
      },
    );
    await t.test(
      "CSV에 없는 상태·담당자·연결 태스크와 시스템 감사 필드는 덮어쓰지 않는다",
      async () => {
        let row = (await service.dashboard()).requirements.find(
          (r) => r.data.sourceId === "TCO-1",
        )!;
        row = (await service.saveRequirement(
          {
            ...editable(row.data),
            status: "in_progress",
            assignee: "developer",
          },
          row.revision,
        ))!;
        await service.convertRequirements({
          entries: [{ id: row.data.id, revision: row.revision }],
        });
        const task = (await service.dashboard()).tasks.find(
          (r) => r.data.id === `prd-task-${row.data.id}`,
        )!;
        assert.ok(task);
        const before = task.data.description;
        const changed = {
          ...file,
          csv: "ID,기능명,상세 설명\nTCO-1,초대 기능 수정,변경된 설명\n",
        };
        const preview = await service.previewRequirementCsv(changed);
        assert.equal(preview.counts.existing, 1);
        assert.deepEqual(
          await service.importRequirementCsv({
            ...changed,
            mode: "update",
            previewHash: preview.previewHash,
          }),
          { created: 0, updated: 1, skipped: 0 },
        );
        const saved = (await store.get<Requirement>(
          "requirement",
          row.data.id,
        ))!;
        assert.equal(saved.data.status, "in_progress");
        assert.equal(saved.data.assignee, "developer");
        assert.equal(saved.data.taskId, task.data.id);
        assert.equal(saved.data.policy, row.data.policy);
        assert.equal(saved.data.source?.editor, "기획자");
        assert.equal(saved.data.description, "변경된 설명");
        assert.equal(
          (await store.get<Task>("task", task.data.id))!.data.description,
          before,
        );
      },
    );
    await t.test(
      "행 오류·미리보기 후 변경 시 전체 작업을 취소한다",
      async () => {
        const bad = { ...file, csv: "ID,기능명\nNEW,정상 행\nBAD,\n" };
        const preview = await service.previewRequirementCsv(bad);
        assert.equal(preview.counts.invalid, 1);
        await assert.rejects(
          service.importRequirementCsv({
            ...bad,
            mode: "skip",
            previewHash: preview.previewHash,
          }),
        );
        assert.equal((await service.dashboard()).requirements.length, 2);
        const before = await service.previewRequirementCsv(file);
        const row = (await service.dashboard()).requirements[0]!;
        await service.saveRequirement(
          { ...editable(row.data), remarks: "동시 편집" },
          row.revision,
        );
        await assert.rejects(
          service.importRequirementCsv({
            ...file,
            mode: "update",
            previewHash: before.previewHash,
          }),
          conflict,
        );
      },
    );
    await t.test(
      "읽기 역할·다른 프로젝트·워크스페이스 접근을 거부한다",
      async () => {
        const reader = new Service(store, { name: "reader", role: "read" });
        await assert.rejects(
          reader.previewRequirementCsv(file),
          (error) => error instanceof DomainError && error.status === 403,
        );
        const scoped = new Service(store, {
          name: "scoped",
          role: "write",
          repositories: ["org/private"],
        });
        await assert.rejects(
          scoped.previewRequirementCsv(file),
          (error) => error instanceof DomainError && error.status === 403,
        );
        const other = new Service(store, {
          name: "other",
          role: "write",
          workspaceId: "separate",
        });
        await assert.rejects(
          other.previewRequirementCsv(file),
          (error) => error instanceof DomainError && error.status === 403,
        );
      },
    );
  } finally {
    await store.close();
  }
});
