import { test, expect } from "@playwright/test";

test("Notion CSV 업로드로 PRD를 채우고 같은 파일의 중복을 막는다", async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  const id = `csv-${Date.now()}`;
  const project = await request.post("/api/projects", {
    data: {
      data: {
        id,
        name: `CSV 테스트 ${id}`,
        goal: "",
        repositories: ["demo/frontend"],
      },
    },
  });
  expect(project.ok()).toBeTruthy();
  const csv =
    '\uFEFF정책,ID,기능명,비고,상세 설명,최종 편집 일시,최종 편집자\n"관리자만, 초대",TCO-1,CSV 초대 기능,원본 비고,"첫 줄에 ""인용문""\n둘째 줄",2026년 10월 23일 오후 2:13,원본 PM\n,TCO-2,CSV 가입 기능,,가입 설명,2026년 10월 1일 오전 12:00,원본 PM\n';
  await page.goto("/");
  await expect(page.locator(".profile-trigger")).toContainText("demo", {
    timeout: 30000,
  });
  await page.getByRole("button", { name: "PRD 관리", exact: true }).click();
  await page.getByRole("combobox", { name: "프로젝트 필터" }).selectOption(id);
  async function upload() {
    await page
      .getByRole("button", { name: "CSV 가져오기", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "PRD CSV 가져오기" });
    await expect(
      dialog.getByRole("combobox", { name: "CSV 대상 프로젝트" }),
    ).toHaveValue(id);
    await dialog.getByLabel("PRD CSV 파일", { exact: true }).setInputFiles({
      name: "3-1 공통 PRD_all.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await dialog.getByRole("button", { name: "파일 미리보기" }).click();
    return dialog;
  }
  const dialog = await upload();
  await expect(dialog.getByRole("status")).toContainText(
    "총 2개 · 신규 2개 · 기존 0개 · 오류 0개",
  );
  await dialog.getByRole("button", { name: "PRD에 가져오기" }).click();
  await expect(dialog).not.toBeVisible();
  const row = page.getByRole("row").filter({
    has: page.getByRole("button", { name: "CSV 초대 기능", exact: true }),
  });
  await expect(row.getByText("원본 ID: TCO-1", { exact: true })).toBeVisible();
  await expect(row.locator("td strong")).toHaveText(/^[A-Z0-9]{5}-001$/);
  await expect(row.getByText("원본: 원본 PM", { exact: true })).toBeAttached();
  const data = await (await request.get("/api/dashboard")).json();
  const rows = data.requirements.filter(
    (r: { data: { project: string } }) => r.data.project === id,
  );
  expect(rows).toHaveLength(2);
  const first = rows.find(
    (r: { data: { sourceId: string } }) => r.data.sourceId === "TCO-1",
  );
  expect(first.data.description).toBe('첫 줄에 "인용문"\n둘째 줄');
  expect(first.data.policy).toBe("관리자만, 초대");
  expect(first.data.source.editedAt).toBe("2026-10-23T05:13:00.000Z");
  expect(first.data.editor).toBe("demo");
  const duplicate = await upload();
  await expect(duplicate.getByRole("status")).toContainText(
    "신규 0개 · 기존 2개",
  );
  await duplicate.getByRole("button", { name: "PRD에 가져오기" }).click();
  await expect(duplicate).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "추가 0개 · 수정 0개 · 건너뜀 2개",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await upload();
  await expect(
    mobile.getByRole("region", { name: "CSV 가져오기 미리보기" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await mobile.getByRole("button", { name: "취소", exact: true }).click();
});

test("닫힌 PR·이슈와 머지 완료는 기본 숨김이며 필터로 다시 볼 수 있다", async ({
  page,
}) => {
  await page.route("**/api/dashboard", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const base = data.items[0];
    data.items = [
      ["열린 PR", "open", "pr"],
      ["닫힌 PR", "closed", "pr"],
      ["닫힌 이슈", "closed", "issue"],
      ["머지 완료 PR", "merged", "pr"],
    ].map(([title, state, kind], index) => ({
      ...base,
      data: {
        ...base.data,
        id: `demo/frontend#${9000 + index}`,
        number: 9000 + index,
        title,
        state,
        kind,
      },
    }));
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await expect(page.locator(".profile-trigger")).toContainText("demo", {
    timeout: 30000,
  });
  await page.getByRole("button", { name: "GitHub 활동", exact: true }).click();
  const checkbox = page.getByRole("checkbox", {
    name: "닫힌 PR·이슈 숨기기 (머지 완료 포함)",
    exact: true,
  });
  await expect(checkbox).toBeChecked();
  const titles = page.locator(".selectable-activity .activity-row strong");
  await expect(titles).toHaveText(["열린 PR"]);
  await checkbox.uncheck();
  await expect(titles).toHaveCount(4);
  await checkbox.check();
  await page
    .getByRole("combobox", { name: "상태 필터" })
    .selectOption("closed");
  await expect(checkbox).not.toBeChecked();
  await expect(titles).toHaveText(["닫힌 PR", "닫힌 이슈"]);
  await page
    .getByRole("combobox", { name: "상태 필터" })
    .selectOption("merged");
  await expect(titles).toHaveText(["머지 완료 PR"]);
  await checkbox.check();
  await expect(page.getByRole("combobox", { name: "상태 필터" })).toHaveValue(
    "",
  );
  await expect(titles).toHaveText(["열린 PR"]);
});
