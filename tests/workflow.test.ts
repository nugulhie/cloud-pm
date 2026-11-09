import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Stored } from "../src/core/model";
import { Store } from "../src/db/store";
import { Service } from "../src/core/service";
import { Users } from "../src/users/service";
import type {
  ChangeReview,
  TaskReview,
  ChangeTarget,
} from "../src/core/review-model";
test("여러 선행 작업이 합류하는 일정은 위상 순서로 최대 지연을 계산한다", async () => {
  const store = new Store(),
    s = new Service(store, { name: "pm", role: "write" });
  try {
    await s.saveProject({
      id: "diamond",
      name: "일정",
      goal: "",
      repositories: [],
    });
    // IDs deliberately place the final task ahead of one of its predecessors.
    for (const task of [
      {
        id: "root",
        startDate: "2026-11-09",
        dueDate: "2026-11-10",
        dependsOn: [],
      },
      {
        id: "z-long",
        startDate: "2026-11-11",
        dueDate: "2026-11-15",
        dependsOn: ["root"],
      },
      {
        id: "b-short",
        startDate: "2026-11-11",
        dueDate: "2026-11-12",
        dependsOn: ["root"],
      },
      {
        id: "a-final",
        startDate: "2026-11-16",
        dueDate: "2026-11-17",
        dependsOn: ["z-long", "b-short"],
      },
    ])
      await s.saveTask({ ...task, project: "diamond", title: task.id });
    const preview = (await s.writeWorkflow("schedule/preview", {
      task: "root",
      days: 4,
    })) as any;
    assert.equal(
      preview.changes.find((t: any) => t.id === "a-final").dueDate,
      "2026-11-21",
    );
    await s.writeWorkflow("milestones", {
      id: "diamond-goal",
      project: "diamond",
      name: "참조 보호",
      targetDate: "2026-12-01",
      taskIds: ["a-final"],
    });
    const final = (await store.get("task", "a-final"))!;
    await assert.rejects(
      s.removeEntities({
        kind: "task",
        entries: [{ id: "a-final", revision: final.revision }],
      }),
      /참조 중/,
    );
    const summary = (await s.readWorkflow("summary", {
      project: "diamond",
      period: "day",
    })) as any;
    assert.equal(summary.activity.created, 4);
    assert.equal(summary.activity.completed, 0);
  } finally {
    await store.close();
  }
});
test("정책 변경 검토는 간접 PRD·하위 작업을 포함하며 명시한 태스크만 반영한다", async () => {
  const store = new Store(),
    service = new Service(store, { name: "pm", role: "write" });
  try {
    await service.saveProject({
      id: "p",
      name: "프로젝트",
      goal: "",
      repositories: [],
    });
    await service.saveKnowledge({
      id: "policy",
      kind: "policy",
      name: "정책",
      content: "이전 정책",
    });
    await service.saveKnowledge({
      id: "child-policy",
      kind: "policy",
      name: "하위 정책",
      content: "상세",
      dependsOn: ["policy"],
    });
    await service.saveRequirement({
      id: "prd",
      project: "p",
      featureName: "기능",
      policyIds: ["child-policy"],
    });
    await service.convertRequirements({
      entries: [
        {
          id: "prd",
          revision: (await store.get("requirement", "prd"))!.revision,
        },
      ],
    });
    const policy = (await store.get("knowledge", "policy"))!;
    await service.patchEntity({
      kind: "knowledge",
      id: "policy",
      revision: policy.revision,
      patch: { content: "새 정책" },
    });
    const review = ((await service.readWorkflow("changes")) as any).items[0]!;
    assert.equal(review.data.project, "p");
    assert.ok(review.data.targets.some((t: ChangeTarget) => t.kind === "task"));
    assert.equal(review.data.before.content, "이전 정책");
    const target = review.data.targets.find(
        (t: ChangeTarget) => t.kind === "task",
      )!,
      task = (await store.get("task", target.id))!;
    await service.writeWorkflow("changes/update", {
      id: review.data.id,
      revision: review.revision,
      target: target.id,
      targetRecordRevision: target.recordRevision,
      kind: "task",
      status: "applied",
      targetRevision: task.revision,
      patch: { description: "정책 반영을 위한 작업" },
    });
    assert.equal(
      (await store.get<any>("task", target.id))!.data.description,
      "정책 반영을 위한 작업",
    );
    assert.equal(
      (
        (await service.readWorkflow("changes")) as any
      ).items[0]!.data.targets.find((t: ChangeTarget) => t.id === target.id)!
        .status,
      "applied",
    );
  } finally {
    await store.close();
  }
});
test("일정 미리보기는 후속 지연과 버전을 검사하고 선택 변경을 반영한다", async () => {
  const store = new Store(),
    s = new Service(store, { name: "pm", role: "write" });
  try {
    await s.saveProject({ id: "p", name: "p", goal: "", repositories: [] });
    await s.saveTask({
      id: "a",
      project: "p",
      title: "A",
      startDate: "2026-11-09",
      dueDate: "2026-11-10",
    });
    await s.saveTask({
      id: "b",
      project: "p",
      title: "B",
      startDate: "2026-11-11",
      dueDate: "2026-11-12",
      dependsOn: ["a"],
    });
    const preview = (await s.writeWorkflow("schedule/preview", {
      task: "a",
      days: 3,
    })) as any;
    assert.equal(
      preview.changes.find((c: any) => c.id === "b").dueDate,
      "2026-11-15",
    );
    await s.writeWorkflow("schedule/apply", {
      task: "a",
      days: 3,
      previewHash: preview.previewHash,
      selected: ["a", "b"],
    });
    assert.equal(
      (await store.get<any>("task", "b"))!.data.dueDate,
      "2026-11-15",
    );
    await assert.rejects(
      s.writeWorkflow("schedule/apply", {
        task: "a",
        days: 3,
        previewHash: preview.previewHash,
        selected: ["a"],
      }),
    );
  } finally {
    await store.close();
  }
});
test("검수 이후 수정은 기존 승인을 배포 근거로 사용할 수 없다", async () => {
  const previous = process.env.DEMO_MODE;
  delete process.env.DEMO_MODE;
  const store = new Store();
  try {
    const user = await new Users(store).register({
      login: "owner",
      displayName: "PM",
      password: "long-test-password",
    });
    const s = new Service(store, {
      name: "owner",
      role: "write",
      userId: user.user.id,
      workspaceRole: "owner",
    });
    await s.saveProject({ id: "p", name: "p", goal: "", repositories: [] });
    const task = (await s.saveTask({
      id: "t",
      project: "p",
      title: "T",
      status: "done",
    }))!;
    await s.writeWorkflow("reviews/request", {
      task: "t",
      taskRevision: task.revision,
      reviewerId: user.user.id,
    });
    const review = (await store.get<TaskReview>("task-review", "t"))!;
    await s.writeWorkflow("reviews/decide", {
      id: "t",
      revision: review.revision,
      status: "approved",
      note: "기획 확인 완료",
    });
    const plan = {
      id: randomUUID(),
      project: "p",
      version: "1.0",
      plannedDate: "2026-11-09",
      actualDate: "2026-11-09",
      taskIds: ["t"],
      status: "released",
    };
    await s.writeWorkflow("releases", plan);
    await s.saveTask({ ...task.data, description: "추가 수정" }, task.revision);
    await assert.rejects(
      s.writeWorkflow("releases", {
        ...plan,
        id: randomUUID(),
        version: "1.1",
      }),
    );
    const denied = new Service(store, {
      name: "other",
      role: "write",
      repositories: ["other/repo"],
    });
    // 다른 워크스페이스에는 기록을 노출하지 않는다.
    assert.equal(
      (
        (await new Service(store.forWorkspace("other"), {
          name: "reader",
          role: "read",
          workspaceId: "other",
        }).readWorkflow("releases")) as any
      ).items.length,
      0,
    );
  } finally {
    await store.close();
    if (previous === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = previous;
  }
});
