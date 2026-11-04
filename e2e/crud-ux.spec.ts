import { test, expect, type APIRequestContext } from "@playwright/test";

async function project(request: APIRequestContext, id: string) {
  const response = await request.post("/api/projects", {
    data: { data: { id, name: id, goal: "", repositories: ["demo/frontend"] } },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data;
}
async function task(
  request: APIRequestContext,
  project: string,
  id: string,
  extra = {},
) {
  const response = await request.post("/api/tasks", {
    data: { data: { id, title: id, project, ...extra } },
  });
  expect(response.ok()).toBeTruthy();
}
async function cleanup(request: APIRequestContext, ids: string[]) {
  const data = await (await request.get("/api/dashboard")).json();
  const entries = data.projects
    .filter((r: { data: { id: string } }) => ids.includes(r.data.id))
    .map((r: { data: { id: string }; revision: number }) => ({
      id: r.data.id,
      revision: r.revision,
    }));
  if (entries.length)
    expect(
      (
        await request.post("/api/manage/delete", {
          data: { kind: "project", entries },
        })
      ).ok(),
    ).toBeTruthy();
}

test("관리 목록의 프로젝트·검색 범위, 수정 모달과 충돌 시 입력 보존", async ({
  page,
  request,
}) => {
  const id = `ux-edit-${Date.now()}`,
    other = `${id}-other`;
  await project(request, id);
  await project(request, other);
  await task(request, id, `${id}-task`);
  await task(request, other, `${other}-task`);
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "항목 관리", exact: true }).click();
    await expect(page.getByLabel("상태 필터")).toHaveCount(0);
    await page.getByLabel("관리 종류").selectOption("task");
    await page.getByLabel("프로젝트 필터").selectOption(id);
    await expect(page.getByLabel("관리 종류")).toHaveValue("task");
    await expect(page.locator(".management-row")).toHaveCount(1);
    await page.getByLabel("관리 항목 검색").fill("없는 항목");
    await expect(page.locator(".management-row")).toHaveCount(0);
    await page
      .getByRole("button", { name: "검색 초기화", exact: true })
      .click();
    await page
      .locator(".management-row")
      .getByRole("button", { name: "수정", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "태스크 관리" }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "닫기", exact: true })
      .click();
    await page.getByLabel("관리 종류").selectOption("project");
    await page
      .locator(".management-row")
      .getByRole("button", { name: "수정", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "프로젝트 수정",
      exact: true,
    });
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel("이름", { exact: true })).toBeFocused();
    await editor
      .getByLabel("이름", { exact: true })
      .fill("작성 중인 프로젝트 이름");
    const snapshot = await (await request.get("/api/dashboard")).json();
    const row = snapshot.projects.find(
      (r: { data: { id: string } }) => r.data.id === id,
    );
    expect(
      (
        await request.post("/api/projects", {
          data: {
            data: { ...row.data, name: "다른 사용자가 저장한 이름" },
            revision: row.revision,
          },
        })
      ).ok(),
    ).toBeTruthy();
    await editor.getByRole("button", { name: "저장", exact: true }).click();
    await expect(editor.getByRole("alert")).toBeVisible();
    await expect(editor.getByLabel("이름", { exact: true })).toHaveValue(
      "작성 중인 프로젝트 이름",
    );
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: "취소", exact: true }).click();
    await page.getByRole("button", { name: "새로고침", exact: true }).click();
    const updated = page
      .locator(".management-row")
      .filter({ hasText: "다른 사용자가 저장한 이름" });
    await expect(updated).toBeVisible();
    await updated.getByRole("button", { name: "삭제", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "삭제 확인", exact: true })
      .click();
    await expect(page.getByLabel("프로젝트 필터")).toHaveValue("");
    await expect(
      page.locator(".management-row").filter({ hasText: other }),
    ).toBeVisible();
  } finally {
    await cleanup(request, [id, other]);
  }
});

test("작업 상세에서 연쇄 삭제 범위와 선행 참조를 확인하고 취소·삭제한다", async ({
  page,
  request,
}) => {
  const id = `ux-delete-${Date.now()}`,
    parent = `${id}-parent`,
    child = `${id}-child`,
    blocker = `${id}-blocker`;
  await project(request, id);
  await task(request, id, parent);
  await task(request, id, child, { parentId: parent });
  await task(request, id, blocker, { dependsOn: [child] });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "항목 관리", exact: true }).click();
    await page.getByLabel("프로젝트 필터").selectOption(id);
    await page.getByLabel("관리 종류").selectOption("task");
    const row = page.locator(".management-row").filter({ hasText: parent });
    await row.getByRole("button", { name: "수정", exact: true }).click();
    await page.getByRole("button", { name: "작업 삭제", exact: true }).click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toContainText("작업 2개");
    await expect(confirmation).toContainText(blocker);
    await expect(
      confirmation.getByRole("button", { name: "삭제 확인", exact: true }),
    ).toBeDisabled();
    await confirmation
      .getByRole("button", { name: "취소", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "태스크 관리" }),
    ).toBeVisible();
    await page
      .getByRole("dialog", { name: "태스크 관리" })
      .getByRole("button", { name: "닫기", exact: true })
      .click();
    const data = await (await request.get("/api/dashboard")).json();
    const entry = data.tasks.find(
      (r: { data: { id: string } }) => r.data.id === blocker,
    );
    expect(
      (
        await request.post("/api/manage/delete", {
          data: {
            kind: "task",
            entries: [{ id: blocker, revision: entry.revision }],
          },
        })
      ).ok(),
    ).toBeTruthy();
    await page.getByRole("button", { name: "새로고침", exact: true }).click();
    await expect(page.locator(".management-row")).toHaveCount(2);
    await row.getByRole("button", { name: "수정", exact: true }).click();
    await page.getByRole("button", { name: "작업 삭제", exact: true }).click();
    await confirmation
      .getByRole("button", { name: "삭제 확인", exact: true })
      .click();
    await expect(confirmation).toHaveCount(0);
    await expect(page.locator(".management-row")).toHaveCount(0);
    await expect(page.locator(".action-notice")).toContainText("삭제했습니다");
  } finally {
    await cleanup(request, [id]);
  }
});

test("일괄 추가 실패 후 성공한 항목을 제외하고 재시도하며 우선순위는 선택한다", async ({
  page,
  request,
}) => {
  const id = `ux-bulk-${Date.now()}`;
  await project(request, id);
  let count = 0;
  await page.route("**/api/tasks", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    count++;
    if (count === 2)
      return route.fulfill({
        status: 503,
        json: { error: "일시적인 저장 실패" },
      });
    await route.continue();
  });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "항목 관리", exact: true }).click();
    await page.getByLabel("프로젝트 필터").selectOption(id);
    await page.getByLabel("관리 종류").selectOption("task");
    const bulk = page
      .locator("details.management-form")
      .filter({ hasText: "태스크 일괄 추가" });
    await bulk.locator("summary").click();
    await expect(bulk.getByLabel("프로젝트", { exact: true })).toHaveValue(id);
    await bulk
      .getByLabel("이름 (한 줄에 하나씩)")
      .fill("첫 작업\n둘째 작업\n셋째 작업");
    await bulk.getByRole("button", { name: "일괄 추가", exact: true }).click();
    await expect(bulk.getByRole("status")).toContainText("1개 등록 후 중단");
    await expect(bulk.getByLabel("이름 (한 줄에 하나씩)")).toHaveValue(
      "둘째 작업\n셋째 작업",
    );
    await bulk.getByRole("button", { name: "일괄 추가", exact: true }).click();
    await expect(bulk.getByRole("status")).toContainText("2개 등록했습니다");
    await expect(page.locator(".management-row")).toHaveCount(3);
    await page
      .getByRole("button", { name: "전체 선택 (최대 100개)", exact: true })
      .click();
    const update = page
      .locator("details.management-form")
      .filter({ hasText: "선택 항목 일괄 수정" });
    await update.locator("summary").click();
    await update.getByLabel("변경 필드").selectOption("priority");
    await update.getByLabel("새 우선순위").selectOption("high");
    await update
      .getByRole("button", { name: "선택 3개 수정", exact: true })
      .click();
    await expect(
      page.locator(".management-panel > [role=status]"),
    ).toContainText("저장했습니다");
    const data = await (await request.get("/api/dashboard")).json();
    const rows = data.tasks.filter(
      (r: { data: { project: string } }) => r.data.project === id,
    );
    expect(rows).toHaveLength(3);
    expect(
      rows.every(
        (r: { data: { priority: string } }) => r.data.priority === "high",
      ),
    ).toBeTruthy();
  } finally {
    await cleanup(request, [id]);
  }
});

test("프로젝트를 바꾼 후 도착한 이전 프로젝트 AI 분석을 섞어 보여주지 않는다", async ({
  page,
  request,
}) => {
  const id = `ux-analysis-${Date.now()}`,
    other = `${id}-other`;
  await project(request, id);
  await project(request, other);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/analysis", async (route) => {
    await pending;
    await route.fulfill({
      json: {
        summary: "첫 프로젝트 전용 요약",
        facts: [],
        interpretations: [],
        unknowns: [],
        generatedAt: new Date().toISOString(),
        truncated: false,
      },
    });
  });
  try {
    await page.goto("/");
    await page.getByLabel("프로젝트 필터").selectOption(id);
    const requested = page.waitForRequest("**/api/analysis");
    await page
      .getByRole("button", { name: "✧ 선택 프로젝트 AI 분석", exact: true })
      .click();
    await requested;
    await page.getByLabel("프로젝트 필터").selectOption(other);
    const completed = page.waitForResponse("**/api/analysis");
    release();
    await completed;
    await expect(
      page.getByRole("button", {
        name: "✧ 선택 프로젝트 AI 분석",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(page.locator(".analysis-panel")).toHaveCount(0);
    await page.getByLabel("프로젝트 필터").selectOption(id);
    await expect(page.locator(".analysis-panel")).toContainText(
      "첫 프로젝트 전용 요약",
    );
  } finally {
    release();
    await cleanup(request, [id, other]);
  }
});
