import { test, expect } from "@playwright/test";

test("GitHub 활동은 원본 변경 최신순이며 수집 시각을 변경 시각과 구분한다", async ({
  page,
}) => {
  await page.route("**/api/dashboard", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const base = data.items[0];
    data.items = [
      {
        ...base,
        updatedAt: "2026-10-28T04:00:00Z",
        data: {
          ...base.data,
          id: "demo/frontend#1",
          number: 1,
          title: "오래된 원본 활동",
          state: "open",
          updatedAt: "2026-09-21T00:00:00Z",
        },
      },
      {
        ...base,
        updatedAt: "2026-10-28T03:00:00Z",
        data: {
          ...base.data,
          id: "demo/frontend#9999",
          number: 9999,
          title: "가장 최근 변경된 원본 활동",
          state: "open",
          updatedAt: "2026-10-28T01:00:00Z",
        },
      },
    ];
    data.syncs = [];
    data.syncInProgress = false;
    data.collection.since = "2026-09-21T00:00:00Z";
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await expect(page.locator(".profile-trigger")).toContainText("demo", {
    timeout: 30000,
  });
  await page.getByRole("button", { name: "GitHub 활동", exact: true }).click();
  const activities = page.locator(".selectable-activity .activity-row strong");
  await expect(activities).toHaveText([
    "가장 최근 변경된 원본 활동",
    "오래된 원본 활동",
  ]);
  const banner = page.locator('[aria-label="GitHub 데이터 최신성"]');
  await expect(banner).toContainText("마지막 데이터 수집:");
  await expect(banner).toContainText("GitHub 원본의 최근 변경:");
  await expect(banner).toContainText("최초 수집 이후에는 웹훅");
  await expect(page.locator("footer")).toContainText("마지막 데이터 수집");
  await expect(page.locator(".activity-list time").first()).toHaveAttribute(
    "datetime",
    "2026-10-28T01:00:00Z",
  );
});
