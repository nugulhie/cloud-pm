import { test, expect } from "@playwright/test";

test("작업 작성 창에서 키보드 이동과 배경 클릭으로 입력을 보호한다", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page
    .getByRole("button", { name: "＋ 태스크 추가", exact: true })
    .first();
  await expect(trigger).toBeEnabled();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "태스크 관리" });
  const title = dialog.getByLabel("제목", { exact: true });
  await expect(title).toBeFocused();
  await title.fill("작성 중인 작업");
  await expect(dialog.locator('[name="id"]')).toBeHidden();
  await expect(dialog.getByLabel("완료 조건 YAML 초안")).toBeHidden();
  await page.locator(".overlay").click({ position: { x: 5, y: 5 } });
  await expect(title).toHaveValue("작성 중인 작업");
  const close = dialog.getByRole("button", { name: "닫기", exact: true });
  const save = dialog.getByRole("button", { name: "저장", exact: true });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(save).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
  await expect(
    page
      .getByRole("button", { name: "PRD 관리", exact: true })
      .locator(".nav-text"),
  ).toBeVisible();
  await page.getByRole("button", { name: "메뉴 닫기", exact: true }).click();
  await trigger.click();
  await expect(title).toBeFocused();
  await expect(save).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("활동을 나누어 표시하고 호환 프로젝트만 연결하며 필터 초기화는 프로젝트를 유지한다", async ({
  page,
}) => {
  const imported: unknown[] = [];
  await page.route("**/api/dashboard", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const base = data.items[0];
    data.projects = [
      {
        data: {
          id: "ux-frontend",
          name: "프론트 프로젝트",
          goal: "",
          repositories: ["DEMO/FRONTEND"],
        },
        revision: 1,
      },
      {
        data: {
          id: "ux-backend",
          name: "백엔드 프로젝트",
          goal: "",
          repositories: ["demo/backend"],
        },
        revision: 1,
      },
    ];
    data.items = Array.from({ length: 45 }, (_, index) => ({
      ...base,
      data: {
        ...base.data,
        id: `demo/frontend#${9800 + index}`,
        number: 9800 + index,
        repository: "demo/frontend",
        kind: "issue",
        title: `UX 활동 ${index + 1}`,
        state: "open",
        updatedAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
      },
    }));
    await route.fulfill({ json: data });
  });
  await page.route("**/api/items/import", async (route) => {
    imported.push(route.request().postDataJSON());
    await route.fulfill({ json: { created: 1, skipped: 0 } });
  });
  await page.goto("/");
  await expect(page.locator(".profile-trigger")).toContainText("demo");
  await page.getByRole("button", { name: "GitHub 활동", exact: true }).click();
  await expect(page.locator(".activity-row")).toHaveCount(40);
  await page.getByRole("button", { name: "다음 40개 더 보기" }).click();
  await expect(page.locator(".activity-row")).toHaveCount(45);
  await expect(page.getByLabel("가져올 프로젝트")).toHaveCount(0);
  await page.getByLabel("선택: UX 활동 45", { exact: true }).check();
  const picker = page.getByLabel("가져올 프로젝트");
  await expect(picker.locator("option")).toHaveText([
    "프로젝트 선택",
    "프론트 프로젝트",
  ]);
  await picker.selectOption("ux-frontend");
  await page
    .getByRole("button", { name: "선택 항목 프로젝트에 추가", exact: true })
    .click();
  await expect(page.locator(".import-toolbar")).toContainText("1개 추가");
  expect(imported).toEqual([
    { project: "ux-frontend", items: ["demo/frontend#9844"] },
  ]);
  await page.getByLabel("프로젝트 필터").selectOption("ux-frontend");
  await page.getByLabel("GitHub 활동 검색").fill("없는 검색어");
  await expect(page.getByText("조건에 맞는 PR·이슈가 없습니다.")).toBeVisible();
  await page
    .locator(".empty-state")
    .getByRole("button", { name: "검색·필터 초기화", exact: true })
    .click();
  await expect(page.getByLabel("프로젝트 필터")).toHaveValue("ux-frontend");
  await expect(page.locator(".activity-row")).toHaveCount(40);
  await page
    .locator(".selectable-activity")
    .first()
    .getByRole("button", { name: "프로젝트에 추가", exact: true })
    .click();
  await expect(page.locator(".action-notice")).toContainText("프론트 프로젝트");
  expect(imported).toHaveLength(2);
  await page.getByLabel("GitHub 활동 검색").fill("없는 검색어");
  await page.getByRole("button", { name: "태스크 보드", exact: true }).click();
  await expect(page.getByLabel("태스크 검색")).toHaveValue("");
  await expect(page.getByLabel("프로젝트 필터")).toHaveValue("ux-frontend");
});
