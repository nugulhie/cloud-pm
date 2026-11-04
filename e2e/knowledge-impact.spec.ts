import { test, expect } from "@playwright/test";
test.use({ actionTimeout: 10000, navigationTimeout: 60000 });
test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({ contentType: "text/css", body: "" }),
  );
});

test("정책 변경 검토에서 프로젝트·PRD 페이지·하위 태스크·PR을 확인하고 원본으로 이동한다", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const suffix = String(Date.now()),
    policy = `impact-policy-${suffix}`,
    term = `impact-term-${suffix}`;
  const post = async (path: string, data: unknown) => {
    const response = await request.post(`/api/${path}`, { data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const initial = await (await request.get("/api/dashboard")).json();
  const pr = initial.items.find((r: any) => r.data.kind === "pr").data;
  for (const [id, kind, name] of [
    [policy, "policy", `검토 정책 ${suffix}`],
    [term, "glossary", `검토 용어 ${suffix}`],
  ])
    await post("knowledge", {
      data: { id, kind, name, content: "## 저장된 기준\n기존 내용" },
    });
  const projects = [`impact-main-${suffix}`, `impact-other-${suffix}`];
  for (const [i, id] of projects.entries())
    await post("projects", {
      data: {
        id,
        name: `${i === 0 ? "영향 프로젝트" : "다른 프로젝트"} ${suffix}`,
        goal: "",
        repositories: [pr.repository],
      },
    });
  let first: any;
  for (let i = 0; i < 42; i++) {
    const row = await post("requirements", {
      data: {
        id: `impact-prd-${suffix}-${i}`,
        project: projects[i === 41 ? 1 : 0],
        featureName: `검토 기능 ${i} ${suffix}`,
        policyIds: [policy],
        glossaryIds: i === 0 ? [term] : [],
      },
    });
    if (i === 0) first = row;
  }
  const converted = await post("requirements/convert", {
    entries: [{ id: first.data.id, revision: first.revision }],
  });
  const taskId = converted.results[0].task;
  const child = await post("tasks", {
    data: {
      id: `impact-child-${suffix}`,
      project: projects[0],
      parentId: taskId,
      title: `검토 하위 태스크 ${suffix}`,
    },
  });
  await post("links/manual", { task: child.data.id, item: pr.id });
  const apiResponse = await request.get(
    `/api/knowledge/impact?id=${policy}&kind=prs`,
  );
  expect(apiResponse.headers()["cache-control"]).toBe("no-store");
  expect((await apiResponse.json()).summary).toMatchObject({
    requirements: 42,
    tasks: 2,
    prs: 1,
  });
  expect(
    (
      await request.get(`/api/knowledge/impact?id=${policy}&limit=101`)
    ).status(),
  ).toBe(400);
  expect(
    (await request.get("/api/knowledge/impact?id=missing-document")).status(),
  ).toBe(404);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "정책 저장소", exact: true }).click();
  const card = page.locator(".knowledge-card").filter({
    has: page.getByRole("heading", {
      name: `검토 정책 ${suffix}`,
      exact: true,
    }),
  });
  await card
    .getByRole("button", { name: "연결·영향 보기", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: `검토 정책 ${suffix} · 연결·영향`,
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "PRD 42", exact: true }),
  ).toBeVisible();
  await expect(dialog.locator(".impact-items > li")).toHaveCount(40);
  await dialog
    .getByRole("combobox", { name: "영향 범위 프로젝트" })
    .selectOption(projects[0]);
  await expect(
    dialog.getByRole("button", { name: "PRD 41", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "다음", exact: true }).click();
  await expect(dialog.locator(".impact-items > li")).toHaveCount(1);
  const selectedTitle = await dialog.locator(".impact-title").innerText();
  await dialog
    .getByRole("button", { name: selectedTitle, exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const prd = page.getByRole("dialog", { name: "PRD 항목 편집", exact: true });
  await expect(prd.getByLabel("기능명", { exact: true })).toHaveValue(
    selectedTitle,
  );
  await prd.getByRole("button", { name: "닫기", exact: true }).last().click();

  await page.getByRole("button", { name: "정책 저장소", exact: true }).click();
  await card.getByRole("button", { name: "편집", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "정책 편집", exact: true });
  await edit
    .getByLabel("정책 내용", { exact: true })
    .fill("## 새 기준\n변경 검토가 필요하다.");
  await expect(
    edit.getByRole("button", { name: "PRD 42", exact: true }),
  ).toBeVisible();
  await edit.getByRole("button", { name: "정책 저장", exact: true }).click();
  await expect(edit).not.toBeVisible();
  await card
    .getByRole("button", { name: "연결·영향 보기", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: `검토 정책 ${suffix} · 연결·영향`,
    exact: true,
  });
  await expect(dialog.getByText(/저장된 문서 v2/)).toBeVisible();
  await dialog.getByRole("button", { name: "태스크 2", exact: true }).click();
  await expect(
    dialog.getByRole("button", {
      name: `검토 하위 태스크 ${suffix}`,
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "PR 1", exact: true }).click();
  await expect(
    dialog.getByRole("link", { name: "GitHub에서 열기 ↗" }),
  ).toHaveAttribute("href", pr.url);
  await expect(dialog.getByText(/하위 태스크/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1))
    .toBe(true);
  await page.screenshot({
    path: ".data/design-update-20261104/knowledge-impact-mobile.png",
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "닫기", exact: true })
    .last()
    .click();
  const final = await (await request.get("/api/dashboard")).json();
  expect(
    final.requirements.find((r: any) => r.data.id === first.data.id).data
      .description,
  ).toBe("");
  expect(final.items.find((r: any) => r.data.id === pr.id).data.body).toBe(
    pr.body,
  );
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole("button", { name: "용어집", exact: true }).click();
  const termCard = page.locator(".knowledge-card").filter({
    has: page.getByRole("heading", {
      name: `검토 용어 ${suffix}`,
      exact: true,
    }),
  });
  await termCard
    .getByRole("button", { name: "연결·영향 보기", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "PRD 1", exact: true }),
  ).toBeVisible();
});

test("읽기 화면에서 영향 조회 실패를 재시도하고 빈 연결을 안내한다", async ({
  page,
  request,
}) => {
  const id = `empty-impact-${Date.now()}`;
  const created = await request.post("/api/knowledge", {
    data: { data: { id, kind: "policy", name: id, content: "빈 참조" } },
  });
  expect(created.ok()).toBeTruthy();
  await page.route("**/api/dashboard", async (route) => {
    const response = await route.fetch(),
      data = await response.json();
    data.viewer.role = "read";
    await route.fulfill({ response, json: data });
  });
  let fail = true;
  await page.route("**/api/knowledge/impact?**", async (route) => {
    if (fail) {
      await route.fulfill({
        status: 503,
        json: { error: "잠시 후 다시 조회하세요." },
      });
    } else await route.continue();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "정책 저장소", exact: true }).click();
  const card = page
    .locator(".knowledge-card")
    .filter({ has: page.getByRole("heading", { name: id, exact: true }) });
  await expect(
    card.getByRole("button", { name: "편집", exact: true }),
  ).toHaveCount(0);
  await card
    .getByRole("button", { name: "연결·영향 보기", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: `${id} · 연결·영향`,
    exact: true,
  });
  await expect(dialog.getByRole("alert")).toContainText(
    "잠시 후 다시 조회하세요.",
  );
  fail = false;
  await dialog.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(dialog.getByText(/연결된 PRD가 없습니다/)).toBeVisible();
});
