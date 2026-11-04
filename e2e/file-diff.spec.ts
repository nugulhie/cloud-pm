import { test, expect } from "@playwright/test";

test("PR 파일 변경을 색상·줄 번호·파일 상태로 표시하고 모바일에서 내부 가로 스크롤한다", async ({
  page,
}) => {
  let detailItem: Record<string, unknown> = {};
  const patch =
    '@@ -10,3 +10,4 @@ example\n const keep = true;\n-const label = "이전";\n+const label = "변경";\n+const extra = true;\n return label;\n@@ -30 +31 @@\n-old value\n+const text = "<script>window.diffInjected=true</script>' +
    "A".repeat(160) +
    '";\n\\ No newline at end of file';
  await page.route("**/api/dashboard", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const pr = data.items.find(
      (row: { data: { kind: string } }) => row.data.kind === "pr",
    );
    delete pr.data.files;
    pr.data.title = "파일 변경 색상 테스트";
    pr.data.state = "open";
    detailItem = pr.data;
    data.items = [pr];
    await route.fulfill({ json: data });
  });
  await page.route("**/api/github/item?**", async (route) =>
    route.fulfill({
      json: {
        ...detailItem,
        filesComplete: true,
        files: [
          {
            path: "src/current.ts",
            previousPath: "src/previous.ts",
            status: "renamed",
            additions: 3,
            deletions: 2,
            patch,
          },
          {
            path: "assets/icon.png",
            status: "added",
            additions: 0,
            deletions: 0,
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "GitHub 활동", exact: true }).click();
  await page
    .locator(".activity-row")
    .filter({ hasText: "파일 변경 색상 테스트" })
    .click();
  const dialog = page.getByRole("dialog", { name: "PR 및 파일 변경" });
  const file = dialog
    .locator(".file-diff")
    .filter({ hasText: "src/current.ts" });
  await expect(file).toContainText("이름 변경");
  await expect(file).toContainText("src/previous.ts → src/current.ts");
  await file.locator("summary").click();
  await expect(file.locator(".diff-added")).toHaveCount(3);
  await expect(file.locator(".diff-deleted")).toHaveCount(2);
  await expect(
    file.locator(".diff-deleted").first().locator(".diff-line-number"),
  ).toHaveText(["11", ""]);
  await expect(
    file.locator(".diff-added").first().locator(".diff-line-number"),
  ).toHaveText(["", "11"]);
  await expect(
    file.locator(".diff-context").last().locator(".diff-line-number"),
  ).toHaveText(["12", "13"]);
  await expect(file.locator(".diff-added .diff-code").first()).toHaveCSS(
    "background-color",
    "rgb(230, 255, 236)",
  );
  await expect(file.locator(".diff-deleted .diff-code").first()).toHaveCSS(
    "background-color",
    "rgb(255, 235, 233)",
  );
  await expect(file.locator("script")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { diffInjected?: boolean }).diffInjected,
    ),
  ).toBeUndefined();
  await file.locator("summary").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/file-diff-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const scroller = file.getByRole("region");
  expect(
    await scroller.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBeTruthy();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBeTruthy();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "test-results/file-diff-mobile.png" });
  const binary = dialog
    .locator(".file-diff")
    .filter({ hasText: "assets/icon.png" });
  await binary.locator("summary").click();
  await expect(binary).toContainText("텍스트 변경 내용이 제공되지 않았습니다");
  await expect(
    binary.getByRole("link", { name: "GitHub 원본 확인 ↗" }),
  ).toBeVisible();
  await file.locator("summary").click();
  await expect(file.locator(".diff-table")).toHaveCount(0);
});
