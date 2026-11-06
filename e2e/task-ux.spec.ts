import { test, expect } from "@playwright/test";

test("태스크 기본 계층·압축 필터·전체 관계 집계·첫 화면·입력 보존을 확인한다", async ({
  page,
  request,
}) => {
  const id = `task-ux-${Date.now()}`,
    title = `출시 준비 ${Date.now()}`;
  const post = async (path: string, data: unknown) => {
    const response = await request.post(`/api/${path}`, { data });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const snapshot = async () => (await request.get("/api/dashboard")).json();
  try {
    await post("projects", {
      data: { id, name: "태스크 UX 검증", goal: "", repositories: [] },
    });
    await post("tasks", {
      data: {
        id: `${id}-parent`,
        project: id,
        title,
        status: "in_progress",
        assignee: "기획자",
        dueDate: "2000-01-01",
        blockedReason: "정책 확인 필요",
      },
    });
    await post("tasks", {
      data: {
        id: `${id}-done`,
        project: id,
        title: "완료한 하위",
        parentId: `${id}-parent`,
        status: "done",
      },
    });
    await post("tasks", {
      data: {
        id: `${id}-ready`,
        project: id,
        title: "대기 중인 하위",
        parentId: `${id}-parent`,
        status: "ready",
        dependsOn: [`${id}-parent`],
      },
    });
    await page.route("https://fonts.googleapis.com/**", (route) =>
      route.abort(),
    );
    await page.route("**/api/dashboard", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.mode = "live";
      data.viewer.userId = "ux-viewer";
      await route.fulfill({ response, json: data });
    });
    await page.goto("/");
    await page
      .getByRole("button", { name: "태스크 보드", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "계층 보기", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator(".task-page .page-heading .actions button"),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "＋ 태스크 추가", exact: true }),
    ).toBeVisible();
    const root = page.locator(
      `.task-hierarchy-row[data-task-id="${id}-parent"]`,
    );
    await page
      .getByRole("textbox", { name: "태스크 검색", exact: true })
      .fill(title);
    await expect(root).toContainText("태스크 UX 검증");
    await page.getByLabel("프로젝트 필터").selectOption(id);
    await page
      .getByRole("textbox", { name: "태스크 검색", exact: true })
      .fill("");
    await expect(root).toContainText("하위 1 / 2개 완료");
    await expect(root).toContainText("차단 · 정책 확인 필요");
    await expect(root.locator(".task-due")).toContainText("기한 초과");
    await root
      .getByRole("button", { name: `${title} 하위 태스크 펼치기`, exact: true })
      .click();
    const waiting = page.locator(
      `.task-hierarchy-row[data-task-id="${id}-ready"]`,
    );
    await expect(waiting).toContainText("선행 대기 1개");
    await waiting
      .getByLabel("대기 중인 하위 상태", { exact: true })
      .selectOption("in_review");
    await expect(
      waiting.getByLabel("대기 중인 하위 상태", { exact: true }),
    ).toHaveValue("in_review");
    await page.locator(".task-filter-menu > summary").click();
    await page
      .getByLabel("상태 필터", { exact: true })
      .selectOption("in_progress");
    await expect(root).toContainText("필터로 하위 2개 숨김");
    await page.getByRole("button", { name: "보드 보기", exact: true }).click();
    const card = page.locator(`.task-card[data-task-id="${id}-parent"]`);
    await expect(card).toContainText("하위 작업 1/2 완료");
    await expect(card.locator("code")).toHaveCount(0);
    await page.getByRole("button", { name: "목록 보기", exact: true }).click();
    await expect(page.locator(`tr[data-task-id="${id}-parent"]`)).toContainText(
      "하위 작업 1/2 완료",
    );
    await page
      .getByRole("button", { name: "검색·필터 초기화", exact: true })
      .click();
    await page.locator(".task-filter-menu > summary").click();
    await page.getByRole("button", { name: "계층 보기", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const planningFilters = page.locator(".saved-view-filters");
    await expect(page.getByLabel("우선순위 필터")).toBeHidden();
    await planningFilters.locator("summary").click();
    await page.getByLabel("우선순위 필터").selectOption("medium");
    await expect(planningFilters.locator("summary")).toContainText("1개 적용");
    await page.getByLabel("우선순위 필터").selectOption("");
    await planningFilters.locator("summary").click();
    const box = await root.boundingBox();
    expect(box!.y).toBeLessThan(500);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    for (const width of [768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1050 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
    }
    await root.locator(".task-hierarchy-title").click();
    const dialog = page.getByRole("dialog", { name: "태스크 관리" });
    await dialog
      .getByRole("button", { name: "태스크 수정", exact: true })
      .click();
    await expect(dialog.getByLabel("완료 조건 YAML 초안")).toBeHidden();
    expect(
      (await dialog.getByLabel("제목", { exact: true }).boundingBox())!.y,
    ).toBeLessThan(
      (await dialog
        .getByRole("region", { name: "하위 태스크 관리" })
        .boundingBox())!.y,
    );
    let writes = 0;
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/api/tasks" &&
        request.method() === "POST"
      )
        writes++;
    });
    await dialog.getByLabel("제목", { exact: true }).fill(`${title} 수정`);
    const sub = dialog.getByRole("region", { name: "하위 태스크 관리" });
    await sub.locator(".task-subtask-open").first().click();
    await expect(sub.getByRole("alert")).toContainText("먼저 저장한 뒤");
    await expect(dialog.getByLabel("제목", { exact: true })).toHaveValue(
      `${title} 수정`,
    );
    expect(writes).toBe(0);
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const stored = (await snapshot()).tasks.find(
      (row: { data: { id: string } }) => row.data.id === `${id}-parent`,
    );
    expect(stored.data.blockedReason).toBe("정책 확인 필요");
    await root.locator(".task-hierarchy-title").click();
    await dialog
      .getByRole("region", { name: "하위 태스크 관리" })
      .locator(".task-subtask-open")
      .first()
      .click();
    await expect(dialog.locator(".task-detail-title")).toHaveText(
      "완료한 하위",
    );
    expect(writes).toBe(1);
  } finally {
    const row = (await snapshot()).projects.find(
      (row: { data: { id: string } }) => row.data.id === id,
    );
    if (row)
      await request.post("/api/manage/delete", {
        data: { kind: "project", entries: [{ id, revision: row.revision }] },
      });
  }
});
