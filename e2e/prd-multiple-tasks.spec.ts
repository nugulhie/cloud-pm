import { test, expect } from "@playwright/test";

test("PM이 하나의 PRD를 프론트엔드·백엔드 태스크로 나누고 각 저장소의 이슈를 미리본다", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const suffix = Date.now(),
    id = `multi-${suffix}`,
    name = `회원가입 ${suffix}`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({ contentType: "text/css", body: "" }),
  );
  // UI의 사용자 선택만 고정한다. PRD 저장·태스크 생성·이슈 미리보기는 실제 로컬 API다.
  await page.route("**/api/github/assignees?**", (route) =>
    route.fulfill({
      json: {
        users: [
          { login: "frontend-dev", repositories: ["demo/frontend"] },
          { login: "backend-dev", repositories: ["demo/backend"] },
        ],
        scope: "repository",
      },
    }),
  );
  const response = await request.post("/api/projects", {
    data: {
      data: {
        id,
        name: `제품 ${suffix}`,
        goal: "",
        repositories: ["demo/frontend", "demo/backend"],
      },
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByLabel("프로젝트 필터", { exact: true }).selectOption(id);
  await page.getByRole("button", { name: "PRD 관리", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "PRD 요구사항", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "＋ PRD 작성", exact: true }).click();
  const prd = page.getByRole("dialog", { name: "PRD 작성", exact: true });
  await prd.getByLabel("기능명", { exact: true }).fill(name);
  await prd
    .getByLabel("상세설명", { exact: true })
    .fill("약관 동의 후 회원가입을 완료한다.");
  await prd.getByRole("button", { name: "PRD 저장", exact: true }).click();
  await expect(prd).not.toBeVisible();
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
  await row
    .getByRole("button", { name: "＋ 개발 태스크 추가", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "PRD 개발 태스크",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "프론트엔드·백엔드로 나누기", exact: true })
    .click();
  await expect(dialog.getByLabel("태스크 1 제목", { exact: true })).toHaveValue(
    `${name} · 프론트엔드`,
  );
  await dialog
    .getByLabel("태스크 1 저장소", { exact: true })
    .scrollIntoViewIfNeeded();
  await dialog
    .getByLabel("태스크 1 저장소", { exact: true })
    .selectOption("demo/frontend");
  await dialog
    .getByLabel("태스크 2 저장소", { exact: true })
    .selectOption("demo/backend");
  await dialog
    .getByLabel("태스크 1 담당자", { exact: true })
    .selectOption("frontend-dev");
  await dialog
    .getByLabel("태스크 2 담당자", { exact: true })
    .selectOption("backend-dev");
  let convertCalls = 0;
  page.on("request", (req) => {
    if (new URL(req.url()).pathname === "/api/requirements/convert")
      convertCalls++;
  });
  await dialog
    .getByRole("button", { name: "2개 태스크 저장", exact: true })
    .evaluate((element) => {
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
    });
  await expect(
    dialog
      .getByRole("list", { name: "연결된 개발 태스크" })
      .getByRole("listitem"),
  ).toHaveCount(2);
  expect(convertCalls).toBe(1);
  const backend = dialog
    .getByRole("listitem")
    .filter({ hasText: `${name} · 백엔드` });
  await expect(backend).toContainText("demo/backend");
  await expect(backend).toContainText("backend-dev");
  await backend
    .getByRole("button", { name: "GitHub 이슈 생성", exact: true })
    .click();
  const issue = page.getByRole("dialog", {
    name: "GitHub 이슈 생성",
    exact: true,
  });
  await expect(
    issue.getByLabel("이슈 대상 저장소", { exact: true }),
  ).toHaveValue("demo/backend");
  await expect(
    issue.getByLabel("이슈 대상 저장소", { exact: true }),
  ).toBeDisabled();
  await expect(
    issue.getByLabel("GitHub 이슈 담당자", { exact: true }),
  ).toHaveValue("backend-dev");
  await issue
    .getByRole("button", { name: "본문 미리보기", exact: true })
    .click();
  await expect(issue.locator(".prd-issue-preview")).toContainText(
    `${name} · 백엔드`,
  );
  const dashboard = await (await request.get("/api/dashboard")).json();
  const tasks = dashboard.tasks.filter(
    (t: { data: { project: string } }) => t.data.project === id,
  );
  expect(tasks).toHaveLength(2);
  const frontend = tasks.find(
    (t: { data: { repository: string } }) =>
      t.data.repository === "demo/frontend",
  );
  await issue
    .getByLabel("이슈 대상 태스크", { exact: true })
    .selectOption(frontend.data.id);
  await expect(issue.locator(".prd-issue-preview")).toHaveCount(0);
  await expect(
    issue.getByLabel("이슈 대상 저장소", { exact: true }),
  ).toHaveValue("demo/frontend");
  await expect(
    issue.getByLabel("GitHub 이슈 담당자", { exact: true }),
  ).toHaveValue("frontend-dev");
  await issue
    .getByRole("button", { name: "본문 미리보기", exact: true })
    .click();
  await expect(issue.locator(".prd-issue-preview")).toContainText(
    `${name} · 프론트엔드`,
  );
  await issue.getByRole("button", { name: "취소", exact: true }).click();
  await expect(
    row.getByRole("button", { name: "태스크 관리 · 2개", exact: true }),
  ).toBeVisible();
  await row
    .getByRole("button", { name: "태스크 관리 · 2개", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "PRD 개발 태스크", exact: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    dialog.getByRole("button", { name: "＋ 태스크 추가", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "＋ 태스크 추가", exact: true })
    .click();
  await expect(
    dialog.getByLabel("태스크 1 제목", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByLabel("태스크 1 제목", { exact: true })
    .fill("모바일 추가 작업");
  await expect(
    dialog.getByLabel("태스크 1 제목", { exact: true }),
  ).toBeInViewport();
  await dialog
    .getByLabel("태스크 1 저장소", { exact: true })
    .scrollIntoViewIfNeeded();
  await dialog
    .getByLabel("태스크 1 저장소", { exact: true })
    .selectOption("demo/frontend");
  await expect(
    dialog.getByLabel("태스크 1 저장소", { exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/prd-multiple-tasks-mobile.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "입력 제거", exact: true }).click();
  await dialog
    .getByRole("button", { name: `${name} · 백엔드`, exact: true })
    .click();
  const detail = page.getByRole("dialog", { name: "태스크 관리", exact: true });
  await expect(detail.getByText("demo/backend", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
