import { test, expect } from "@playwright/test";
test.use({ actionTimeout: 10000, navigationTimeout: 60000 });
test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({ contentType: "text/css", body: "" }),
  );
});

test("체크박스로 정책을 추가·해제하고 기준 정책에서 간접 PRD와 의존 정책을 조회한다", async ({
  page,
  request,
}) => {
  const suffix = Date.now(),
    base = `base-${suffix}`,
    refund = `refund-${suffix}`,
    returns = `return-${suffix}`,
    term = `term-${suffix}`,
    project = `p-${suffix}`;
  const names = {
    base: `결제 기준 ${suffix}`,
    refund: `환불 규칙 ${suffix}`,
    returns: `반품 규칙 ${suffix}`,
    term: `정산 용어 ${suffix}`,
  };
  const post = async (path: string, data: unknown) => {
    const response = await request.post(`/api/${path}`, { data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  await post("projects", {
    data: {
      id: project,
      name: `검토 제품 ${suffix}`,
      goal: "",
      repositories: [],
    },
  });
  for (const [id, name, dependsOn] of [
    [base, names.base, []],
    [refund, names.refund, []],
    [returns, names.returns, [refund]],
  ] as const)
    await post("knowledge", {
      data: { id, name, kind: "policy", content: "검토 기준", dependsOn },
    });
  await post("knowledge", {
    data: { id: term, name: names.term, kind: "glossary", content: "정의" },
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "정책 저장소", exact: true }).click();
  const card = (name: string) =>
    page
      .locator(".knowledge-card")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await card(names.refund)
    .getByRole("button", { name: "편집", exact: true })
    .click();
  let edit = page.getByRole("dialog", { name: "정책 편집", exact: true });
  let dependencies = edit.getByRole("group", {
    name: "따르는 정책",
    exact: true,
  });
  await dependencies
    .getByRole("button", { name: "기준 정책 선택", exact: true })
    .click();
  await dependencies
    .getByRole("searchbox", { name: "따르는 정책 검색" })
    .fill(names.base);
  await dependencies
    .getByRole("checkbox", { name: names.base, exact: true })
    .check();
  await edit.getByRole("button", { name: "정책 저장", exact: true }).click();
  await expect(edit).not.toBeVisible();

  await page.getByRole("button", { name: "PRD 관리", exact: true }).click();
  await page
    .getByRole("combobox", { name: "프로젝트 필터", exact: true })
    .selectOption(project);
  await page.getByRole("button", { name: "＋ PRD 작성", exact: true }).click();
  let prd = page.getByRole("dialog", { name: "PRD 작성", exact: true });
  const feature = `환불 처리 ${suffix}`;
  await prd.getByLabel("기능명", { exact: true }).fill(feature);
  let policies = prd.getByRole("group", { name: "관련 정책", exact: true });
  await policies
    .getByRole("button", { name: "정책 선택", exact: true })
    .click();
  const search = policies.getByRole("searchbox", {
    name: "관련 정책 검색",
    exact: true,
  });
  await search.fill(names.refund);
  await policies
    .getByRole("checkbox", { name: names.refund, exact: true })
    .check();
  await search.fill(names.base);
  await policies
    .getByRole("checkbox", { name: names.base, exact: true })
    .check();
  await search.fill("일치하지 않는 이름");
  await expect(
    policies.getByRole("button", {
      name: `${names.refund} 연결 해제`,
      exact: true,
    }),
  ).toBeVisible();
  await policies
    .getByRole("button", { name: "정책 선택 닫기", exact: true })
    .click();
  await policies
    .getByRole("button", { name: `${names.base} 연결 해제`, exact: true })
    .click();
  const terms = prd.getByRole("group", { name: "관련 용어", exact: true });
  await terms.getByRole("button", { name: "용어 선택", exact: true }).click();
  await terms
    .getByRole("searchbox", { name: "관련 용어 검색" })
    .fill(names.term);
  await terms.getByRole("checkbox", { name: names.term, exact: true }).check();
  await prd.getByRole("button", { name: "PRD 저장", exact: true }).click();
  await expect(prd).not.toBeVisible();
  let data = await (await request.get("/api/dashboard")).json();
  const row = data.requirements.find(
    (r: any) => r.data.featureName === feature,
  );
  expect(row.data.policyIds).toEqual([refund]);
  expect(row.data.glossaryIds).toEqual([term]);

  await page.getByRole("button", { name: "정책 저장소", exact: true }).click();
  await card(names.base)
    .getByRole("button", { name: "연결·영향 보기", exact: true })
    .click();
  let impact = page.getByRole("dialog", {
    name: `${names.base} · 연결·영향`,
    exact: true,
  });
  await expect(
    impact.getByRole("button", { name: "PRD 1", exact: true }),
  ).toBeVisible();
  await expect(
    impact.getByText(`정책 연결: ${names.refund} → ${names.base} (간접 참조)`, {
      exact: true,
    }),
  ).toBeVisible();
  await impact
    .getByRole("combobox", { name: "정책 연결 범위" })
    .selectOption("direct");
  await expect(
    impact.getByRole("button", { name: "PRD 0", exact: true }),
  ).toBeVisible();
  await impact
    .getByRole("combobox", { name: "정책 연결 범위" })
    .selectOption("all");
  await expect(
    impact.getByRole("button", { name: "PRD 1", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => impact.evaluate((el) => el.scrollWidth <= el.clientWidth + 1))
    .toBe(true);
  await page.screenshot({
    path: ".data/policy-dependencies-20261104/impact-mobile.png",
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await impact
    .getByRole("button", { name: "의존 정책 2", exact: true })
    .click();
  await impact
    .getByRole("button", { name: names.returns, exact: true })
    .click();
  impact = page.getByRole("dialog", {
    name: `${names.returns} · 연결·영향`,
    exact: true,
  });
  await impact.locator(".impact-policy-relations > summary").click();
  await impact
    .getByRole("button", { name: `${names.refund} ↗`, exact: true })
    .click();
  impact = page.getByRole("dialog", {
    name: `${names.refund} · 연결·영향`,
    exact: true,
  });
  await expect(
    impact.getByRole("button", { name: "PRD 1", exact: true }),
  ).toBeVisible();
  await impact
    .getByRole("button", { name: "닫기", exact: true })
    .last()
    .click();
  await card(names.base)
    .getByRole("button", { name: "편집", exact: true })
    .click();
  edit = page.getByRole("dialog", { name: "정책 편집", exact: true });
  dependencies = edit.getByRole("group", { name: "따르는 정책", exact: true });
  await dependencies
    .getByRole("button", { name: "기준 정책 선택", exact: true })
    .click();
  await dependencies
    .getByRole("searchbox", { name: "따르는 정책 검색" })
    .fill(names.refund);
  await expect(
    dependencies.getByRole("checkbox", { name: names.refund, exact: true }),
  ).toBeDisabled();
  await edit.getByRole("button", { name: "닫기", exact: true }).last().click();
  await page.getByRole("button", { name: "PRD 관리", exact: true }).click();
  await page.getByRole("button", { name: feature, exact: true }).click();
  prd = page.getByRole("dialog", { name: "PRD 항목 편집", exact: true });
  policies = prd.getByRole("group", { name: "관련 정책", exact: true });
  await policies
    .getByRole("button", { name: "정책 선택", exact: true })
    .click();
  await policies
    .getByRole("searchbox", { name: "관련 정책 검색" })
    .fill(names.refund);
  await expect(
    policies.getByRole("checkbox", { name: names.refund, exact: true }),
  ).toBeChecked();
  await policies
    .getByRole("checkbox", { name: names.refund, exact: true })
    .uncheck();
  await prd.getByRole("button", { name: "PRD 저장", exact: true }).click();
  await expect(prd).not.toBeVisible();
  data = await (await request.get("/api/dashboard")).json();
  expect(
    data.requirements.find((r: any) => r.data.id === row.data.id).data
      .policyIds,
  ).toEqual([]);
  expect(
    data.requirements.find((r: any) => r.data.id === row.data.id).data
      .glossaryIds,
  ).toEqual([term]);
  expect(
    (await (await request.get(`/api/knowledge/impact?id=${base}`)).json())
      .summary.requirements,
  ).toBe(0);
});

test("정책 10개 제한을 안내하고 선택 해제 뒤 다른 정책을 추가할 수 있다", async ({
  page,
  request,
}) => {
  const suffix = Date.now(),
    prefix = `제한 검증 ${suffix}`;
  for (let i = 0; i < 12; i++) {
    const response = await request.post("/api/knowledge", {
      data: {
        data: {
          id: `limit-${suffix}-${i}`,
          kind: "policy",
          name: `${prefix} ${i}`,
          content: "기준",
        },
      },
    });
    expect(response.ok()).toBeTruthy();
  }
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "PRD 관리", exact: true }).click();
  await page.getByRole("button", { name: "＋ PRD 작성", exact: true }).click();
  const form = page.getByRole("dialog", { name: "PRD 작성", exact: true });
  await form.getByLabel("기능명", { exact: true }).fill(prefix);
  const picker = form.getByRole("group", { name: "관련 정책", exact: true });
  await picker.getByRole("button", { name: "정책 선택", exact: true }).click();
  await picker.getByRole("searchbox", { name: "관련 정책 검색" }).fill(prefix);
  for (let i = 0; i < 10; i++)
    await picker
      .getByRole("checkbox", { name: `${prefix} ${i}`, exact: true })
      .check();
  await expect(
    picker.getByRole("checkbox", { name: `${prefix} 10`, exact: true }),
  ).toBeDisabled();
  await picker
    .getByRole("checkbox", { name: `${prefix} 0`, exact: true })
    .uncheck();
  await picker
    .getByRole("checkbox", { name: `${prefix} 10`, exact: true })
    .check();
  await picker
    .getByRole("searchbox", { name: "관련 정책 검색" })
    .fill("없는 정책");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => form.evaluate((el) => el.scrollWidth <= el.clientWidth + 1))
    .toBe(true);
  await page.screenshot({
    path: ".data/policy-dependencies-20261104/prd-picker-mobile.png",
  });
  await form.getByRole("button", { name: "PRD 저장", exact: true }).click();
  await expect(form).not.toBeVisible();
  const data = await (await request.get("/api/dashboard")).json();
  const selected = data.requirements.find(
    (r: any) => r.data.featureName === prefix,
  ).data.policyIds;
  expect(selected).toHaveLength(10);
  expect(selected).not.toContain(`limit-${suffix}-0`);
  expect(selected).toContain(`limit-${suffix}-10`);
});
