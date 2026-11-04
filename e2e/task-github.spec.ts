import { test, expect } from "@playwright/test";

test("발행된 이슈·PR 연결이 계층·목록·보드와 접히지 않은 태스크 상세에 표시된다", async ({
  page,
}) => {
  await page.route("**/api/dashboard", async (route) => {
    const data = await (await route.fetch()).json();
    data.projects = [
      {
        data: {
          id: "linked-project",
          name: "연결 프로젝트",
          goal: "",
          repositories: ["demo/frontend"],
        },
        revision: 1,
      },
    ];
    data.features = [];
    data.tasks = [
      {
        data: {
          id: "published-task",
          project: "linked-project",
          feature: "legacy-feature",
          title: "발행된 요구사항",
          description: "",
          status: "backlog",
          assignee: "",
          priority: "medium",
          dueDate: null,
          blockedReason: "",
          yaml: "",
        },
        revision: 1,
      },
    ];
    data.items = [75, 76, 77].map((number) => ({
      data: {
        id: `demo/frontend#${number}`,
        repository: "demo/frontend",
        number,
        kind: number === 76 ? "pr" : "issue",
        title: number === 76 ? "구현 PR" : "등록한 GitHub 이슈",
        body: "본문",
        author: "dev",
        assignees: [],
        reviewers: [],
        state: number === 76 ? "merged" : "open",
        url: `https://github.com/demo/frontend/${number === 76 ? "pull" : "issues"}/${number}`,
        updatedAt: new Date().toISOString(),
      },
      revision: 1,
    }));
    data.links = [75, 76, 77].map((number) => ({
      data: {
        id: `published-task:demo/frontend#${number}`,
        task: "published-task",
        item: `demo/frontend#${number}`,
        status: number === 77 ? "rejected" : "approved",
        reason: "PRD에서 GitHub 이슈 생성",
        method: "manual",
      },
      revision: 1,
    }));
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "태스크 보드", exact: true }).click();
  const hierarchy = page.locator(
    '.task-hierarchy-row[data-task-id="published-task"]',
  );
  await expect(hierarchy.getByLabel("GitHub 연결 2개")).toContainText(
    "이슈 #75",
  );
  await expect(hierarchy.getByLabel("GitHub 연결 2개")).toContainText("PR #76");
  await expect(hierarchy).not.toContainText("#77");
  await hierarchy.locator(".task-hierarchy-title").click();
  const dialog = page.getByRole("dialog", { name: "태스크 관리", exact: true });
  const connected = dialog.getByRole("region", { name: "태스크 GitHub 연결" });
  await expect(connected).toBeVisible();
  await expect(
    connected.getByRole("link", { name: /등록한 GitHub 이슈/ }),
  ).toHaveAttribute("href", "https://github.com/demo/frontend/issues/75");
  await expect(connected).toContainText("머지 완료");
  await connected.scrollIntoViewIfNeeded();
  await dialog.screenshot({
    path: ".data/ux-review/task-github-connections.png",
  });
  await dialog
    .getByRole("button", { name: "태스크 수정", exact: true })
    .click();
  await expect(dialog.locator("details.links")).not.toHaveAttribute("open", "");
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "목록 보기", exact: true }).click();
  await expect(
    page
      .locator('tr[data-task-id="published-task"]')
      .getByLabel("GitHub 연결 2개"),
  ).toContainText("이슈 #75");
  await page.getByRole("button", { name: "보드 보기", exact: true }).click();
  await expect(
    page
      .locator('.task-card[data-task-id="published-task"]')
      .getByLabel("GitHub 연결 2개"),
  ).toContainText("PR #76");
});
