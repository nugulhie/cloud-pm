import { test, expect } from "@playwright/test";

test("GitHub 종류·프로젝트 필터와 담당자·리뷰·라벨을 함께 표시한다", async ({
  page,
}) => {
  const details = new Map<string, unknown>();
  await page.route("**/api/dashboard", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const base = data.items[0];
    data.projects = [
      {
        data: {
          id: "scope-a",
          name: "선택 프로젝트",
          goal: "",
          repositories: ["DEMO/FRONTEND"],
        },
        revision: 1,
        updatedAt: new Date().toISOString(),
      },
    ];
    data.items = [
      {
        kind: "pr",
        repository: "demo/frontend",
        title: "연결 PR",
        number: 9701,
      },
      {
        kind: "issue",
        repository: "demo/frontend",
        title: "연결 이슈",
        number: 9702,
      },
      {
        kind: "pr",
        repository: "demo/backend",
        title: "다른 저장소 PR",
        number: 9703,
      },
    ].map((item) => ({
      ...base,
      data: {
        ...base.data,
        ...item,
        id: `${item.repository}#${item.number}`,
        state: "open",
        labels: [{ name: "검증 라벨", color: "00aa88" }],
        assignees: ["담당 개발자"],
        reviewers: ["리뷰어"],
        reviewerTeams: ["프론트팀"],
      },
    }));
    for (const row of data.items) details.set(row.data.id, row.data);
    await route.fulfill({ json: data });
  });
  await page.route("**/api/github/item?*", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("id") ?? "";
    const item = details.get(id);
    await route.fulfill({
      status: item ? 200 : 404,
      json: item ?? { error: "항목 없음" },
    });
  });
  await page.goto("/");
  await expect(page.locator(".profile-trigger")).toContainText("demo", {
    timeout: 30000,
  });
  await page.getByRole("button", { name: "GitHub 활동", exact: true }).click();
  const titles = page.locator(".activity-row strong");
  await expect(titles).toHaveCount(3);
  await page.getByLabel("프로젝트 필터").selectOption("scope-a");
  await expect(titles).toHaveText(["연결 PR", "연결 이슈"]);
  await expect(page.getByLabel("저장소 필터").locator("option")).toHaveCount(2);
  await expect(page.getByLabel("가져올 프로젝트")).toHaveCount(0);
  await page.getByLabel("선택: 연결 PR", { exact: true }).check();
  await expect(page.getByLabel("가져올 프로젝트")).toHaveValue("scope-a");
  await page.getByLabel("활동 유형").selectOption("pr");
  await expect(titles).toHaveText(["연결 PR"]);
  const row = page.locator(".activity-row").filter({ hasText: "연결 PR" });
  await expect(row).toContainText("담당자: 담당 개발자");
  await expect(row).toContainText("리뷰 요청: 리뷰어, 팀 프론트팀");
  await expect(row).toContainText("검증 라벨");
  await row.click();
  await expect(
    page.getByRole("dialog", { name: "PR 및 파일 변경" }),
  ).toContainText("리뷰 요청: 리뷰어, 팀 프론트팀");
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByLabel("활동 유형").selectOption("issue");
  await expect(titles).toHaveText(["연결 이슈"]);
  await expect(page.locator(".activity-row")).not.toContainText("리뷰 요청:");
  await page.getByLabel("프로젝트 필터").selectOption("");
  await page.getByLabel("활동 유형").selectOption("");
  await expect(titles).toHaveCount(3);
});
