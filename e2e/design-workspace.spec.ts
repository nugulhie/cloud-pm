import { test, expect, type Page } from "@playwright/test";

async function navigate(page: Page, tab: string) {
  if ((page.viewportSize()?.width ?? 1440) <= 720)
    await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
  await page.getByRole("button", { name: tab, exact: true }).click();
}

test("대량 태스크에서도 확인 필요 작업이 먼저 보이고 취소를 완료율에서 제외한다", async ({
  page,
}) => {
  await page.route("**/api/dashboard", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const original = data.tasks[0];
    const project = data.projects[0].data.id;
    data.projects = [data.projects[0]];
    data.tasks = Array.from({ length: 80 }, (_, i) => ({
      ...original,
      data: {
        ...original.data,
        id: `design-summary-${i}`,
        title: `출시 항목 ${i + 1}`,
        project,
        status: i < 20 ? "done" : i < 30 ? "canceled" : "in_progress",
        blockedReason: i === 30 ? "정책 확정 대기" : "",
        assignee: "담당자",
      },
    }));
    await route.fulfill({ response, json: data });
  });
  await page.goto("/");
  const summary = page.getByRole("region", { name: "프로젝트별 진행 현황" });
  await expect(summary).toContainText("20 / 70개 완료", { timeout: 30000 });
  await expect(summary).toContainText("차단 1개");
  await expect(summary.getByRole("progressbar")).toHaveAttribute("value", "29");
  // Intervention comes first (PRODUCT.md principle 2); the project ledger follows it.
  const attention = page.getByRole("region", { name: "확인이 필요한 작업" });
  const attentionTop = (await attention.boundingBox())!.y;
  expect(attentionTop).toBeLessThan(600);
  expect((await summary.boundingBox())!.y).toBeGreaterThan(attentionTop);
  await expect(page.locator(".feature-card")).toHaveCount(6);
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await attention.boundingBox())!.y).toBeLessThan(844);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: ".data/design-update-20261104/overview-mobile.png",
    fullPage: true,
  });
});

test("PRD 간단 보기에서 담당자와 태스크를 확인하고 전체 열 보기로 전환한다", async ({
  page,
}) => {
  await page.route("**/api/dashboard", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.requirements = [
      {
        data: {
          id: "design-prd",
          project: data.projects[0].data.id,
          number: 1,
          featureName: "멤버 초대 정책",
          description: "초대 과정의 정책을 확인합니다.",
          policy: "초대 유효기간 7일",
          remarks: "검토 필요",
          status: "approved",
          assignee: "pm-developer",
          editor: "기획자",
          taskId: data.tasks[0].data.id,
          featureId: null,
        },
        revision: 1,
        updatedAt: new Date().toISOString(),
      },
    ];
    await route.fulfill({ response, json: data });
  });
  await page.goto("/");
  await navigate(page, "PRD 관리");
  await expect(
    page.getByRole("button", { name: "간단 보기", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("columnheader", { name: "상세설명", exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("columnheader", { name: "담당자", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "태스크 열기", exact: true }),
  ).toBeInViewport();
  await expect(page.locator(".page-heading .actions button")).toHaveCount(0);
  await page.getByRole("button", { name: "전체 열 보기", exact: true }).click();
  await expect(
    page.getByRole("columnheader", { name: "상세설명", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "간단 보기", exact: true }).click();
  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page
        .locator(".prd-table-scroll")
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBeTruthy();
  }
  await expect(page.locator(".prd-assignee")).toContainText("pm-developer");
  expect(
    await page
      .locator(".prd-table-scroll")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBeTruthy();
  await page.screenshot({
    path: ".data/design-update-20261104/prd-mobile.png",
    fullPage: true,
  });
});

test("태스크는 Markdown 조회로 열리고 상태 변경 후 최신 버전으로 편집한다", async ({
  page,
}) => {
  let task: any;
  let savedRevision = 0;
  await page.route("**/api/dashboard", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    task ??= {
      ...data.tasks[0],
      data: {
        ...data.tasks[0].data,
        id: "design-view-task",
        title: "디자인 조회 검증",
        description: "## 완료 기준\n- [x] 정책 검토\n- [ ] 출시 준비",
        status: "in_progress",
      },
      revision: 4,
    };
    data.tasks = [task];
    await route.fulfill({ response, json: data });
  });
  await page.route("**/api/tasks", async (route) => {
    const body = route.request().postDataJSON();
    savedRevision = body.revision;
    task = { ...task, data: body.data, revision: task.revision + 1 };
    await route.fulfill({ json: task });
  });
  await page.goto("/");
  await navigate(page, "태스크 보드");
  await page.locator(".task-hierarchy-title").click();
  const dialog = page.getByRole("dialog", { name: "태스크 관리", exact: true });
  await expect(
    dialog.getByRole("heading", { name: "완료 기준", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "제목", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByLabel("디자인 조회 검증 상태", { exact: true })
    .selectOption("in_review");
  await expect(
    dialog.getByLabel("디자인 조회 검증 상태", { exact: true }),
  ).toHaveValue("in_review");
  expect(savedRevision).toBe(4);
  await dialog
    .getByRole("button", { name: "태스크 수정", exact: true })
    .click();
  await expect(dialog.getByLabel("제목", { exact: true })).toBeFocused();
  await dialog.getByLabel("제목", { exact: true }).fill("검토 완료");
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".task-hierarchy-title")).toContainText(
    "검토 완료",
  );
  expect(savedRevision).toBe(5);
});

test("모바일 메뉴는 본문을 가리지 않고 키보드로 열고 닫을 수 있다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "메뉴 열기", exact: true });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("button", { name: "PRD 관리", exact: true }),
  ).toBeHidden();
  await trigger.click();
  await expect(
    page.getByRole("button", { name: "PRD 관리", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await navigate(page, "PRD 관리");
  await expect(
    page.getByRole("heading", { name: "PRD 관리", exact: true, level: 1 }),
  ).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("모바일 워크스페이스 창의 Esc는 먼저 창을 닫고 메뉴를 유지한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/dashboard", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.viewer.userId = "navigation-review";
    await route.fulfill({ response, json: data });
  });
  await page.route("**/api/auth/workspaces", (route) =>
    route.fulfill({
      json: {
        currentId: "main",
        workspaces: [{ id: "main", name: "제품 개발", role: "owner" }],
      },
    }),
  );
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "메뉴 열기", exact: true });
  await trigger.click();
  await page
    .getByRole("button", { name: "워크스페이스 선택 및 생성", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "워크스페이스 선택 및 생성",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  expect(
    await page
      .locator("dialog.workspace-dialog")
      .evaluate((element) => (element as HTMLDialogElement).open),
  ).toBe(false);
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", { name: "PRD 관리", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
});

test("확인이 필요한 작업에서 상세를 열지 않고 담당자를 지정한다", async ({
  page,
}) => {
  const member = {
    id: "11111111-1111-4111-8111-111111111111",
    login: "jiwon",
    displayName: "김지원",
    githubLogin: "jiwon-kim",
    githubId: null,
    role: "write",
  };
  let task: any;
  let saved: any = null;
  await page.route("**/api/dashboard", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    task ??= {
      ...data.tasks[0],
      data: {
        ...data.tasks[0].data,
        id: "design-unassigned",
        title: "담당자 없는 출시 점검",
        assignee: "",
        assigneeUserId: null,
        status: "in_progress",
        blockedReason: "",
      },
      revision: 2,
    };
    data.tasks = [task];
    data.attention = task.data.assignee
      ? []
      : [
          {
            task: task.data.id,
            title: task.data.title,
            reasons: ["담당자 미지정"],
          },
        ];
    await route.fulfill({ response, json: data });
  });
  await page.route("**/api/planning/people**", (route) =>
    route.fulfill({ json: { items: [member], nextOffset: null } }),
  );
  await page.route("**/api/tasks", async (route) => {
    saved = route.request().postDataJSON();
    task = { ...task, data: saved.data, revision: task.revision + 1 };
    await route.fulfill({ json: task });
  });
  await page.goto("/");
  const attention = page.getByRole("region", { name: "확인이 필요한 작업" });
  const picker = attention.getByRole("combobox", {
    name: "담당자 없는 출시 점검 담당자 지정",
    exact: true,
  });
  await expect(picker).toBeEnabled({ timeout: 30000 });
  await picker.selectOption({ label: "김지원 · @jiwon-kim" });
  // The answer stays in the row that asked, and the detail panel never opens.
  const settledRow = attention.locator(".attention-settled");
  await expect(settledRow).toContainText("담당자 없는 출시 점검");
  await expect(settledRow).toContainText("담당자 지정: 김지원 · @jiwon-kim");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(saved.revision).toBe(2);
  expect(saved.data.assignee).toBe("jiwon-kim");
  expect(saved.data.assigneeUserId).toBe(member.id);
  expect(saved.data.title).toBe("담당자 없는 출시 점검");
  // Undo restores the previous owner at the task's current revision.
  const undo = settledRow.getByRole("button", {
    name: "되돌리기",
    exact: true,
  });
  await expect(undo).toBeFocused();
  await undo.click();
  await expect(settledRow).toHaveCount(0);
  await expect(picker).toBeEnabled();
  expect(saved.revision).toBe(3);
  expect(saved.data.assignee).toBe("");
  expect(saved.data.assigneeUserId).toBe(null);
});

test("서비스 계정이 없는 워크스페이스는 GitHub 담당자로 지정한다", async ({
  page,
}) => {
  let task: any;
  let saved: any = null;
  await page.route("**/api/dashboard", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    task ??= {
      ...data.tasks[0],
      data: {
        ...data.tasks[0].data,
        id: "design-github-only",
        title: "외주 연동 점검",
        assignee: "",
        assigneeUserId: null,
        status: "ready",
        blockedReason: "",
      },
      revision: 5,
    };
    data.tasks = [task];
    data.attention = task.data.assignee
      ? []
      : [
          {
            task: task.data.id,
            title: task.data.title,
            reasons: ["담당자 미지정"],
          },
        ];
    await route.fulfill({ response, json: data });
  });
  // No service accounts yet: the queue must still be usable.
  await page.route("**/api/planning/people**", (route) =>
    route.fulfill({ json: { items: [], nextOffset: null } }),
  );
  await page.route("**/api/github/assignees**", (route) =>
    route.fulfill({
      json: { users: [{ login: "octo-dev", repositories: [] }] },
    }),
  );
  await page.route("**/api/tasks", async (route) => {
    saved = route.request().postDataJSON();
    task = { ...task, data: saved.data, revision: task.revision + 1 };
    await route.fulfill({ json: task });
  });
  await page.goto("/");
  const attention = page.getByRole("region", { name: "확인이 필요한 작업" });
  const picker = attention.getByRole("combobox", {
    name: "외주 연동 점검 담당자 지정",
    exact: true,
  });
  await expect(picker).toBeEnabled({ timeout: 30000 });
  await picker.selectOption({ label: "@octo-dev · GitHub" });
  await expect(attention.locator(".attention-settled")).toContainText(
    "담당자 지정: @octo-dev · GitHub",
  );
  expect(saved.data.assignee).toBe("octo-dev");
  expect(saved.data.assigneeUserId).toBe(null);
});
