import { test, expect } from "@playwright/test";
test("연결된 GitHub 항목은 현재 프로젝트 연결 상태를 표시하고 일괄 추가에서 제외한다", async ({
  page,
}) => {
  const requests: any[] = [];
  await page.route("**/api/dashboard", async (route) => {
    const original = await (await route.fetch()).json();
    original.projects = [
      {
        data: {
          id: "linked",
          name: "연결 프로젝트",
          goal: "",
          repositories: ["demo/frontend"],
        },
        revision: 1,
      },
    ];
    original.features = [];
    original.tasks = [
      {
        data: {
          id: "linked-task",
          project: "linked",
          feature: "legacy-missing-feature",
          title: "기존 연결 작업",
          assignee: "",
          status: "backlog",
          description: "",
          priority: "medium",
          dueDate: null,
          blockedReason: "",
          yaml: "",
        },
        revision: 1,
      },
    ];
    original.items = [1, 2].map((number) => ({
      data: {
        id: `demo/frontend#${number}`,
        repository: "demo/frontend",
        number,
        kind: "issue",
        title: `연결 확인 ${number}`,
        body: "",
        author: "developer",
        assignees: [],
        reviewers: [],
        state: "open",
        url: `https://github.com/demo/frontend/issues/${number}`,
        updatedAt: new Date().toISOString(),
      },
      revision: 1,
    }));
    original.links = [
      {
        data: {
          id: "link-one",
          task: "linked-task",
          item: "demo/frontend#1",
          status: "approved",
          reason: "existing",
          method: "manual",
        },
        revision: 1,
      },
    ];
    await route.fulfill({ json: original });
  });
  await page.route("**/api/items/import", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { created: 1, skipped: 0 } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "GitHub 활동", exact: true }).click();
  const linked = page
    .locator(".selectable-activity")
    .filter({ has: page.getByText("연결 확인 1", { exact: true }) });
  await expect(linked.getByLabel("연결된 프로젝트 및 작업")).toContainText(
    "연결 프로젝트",
  );
  await expect(
    linked.getByRole("button", { name: "다른 프로젝트에 추가", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "프로젝트 필터" })
    .selectOption("linked");
  await expect(
    linked.getByRole("button", { name: "현재 프로젝트에 연결됨", exact: true }),
  ).toBeDisabled();
  await linked.getByRole("checkbox").check();
  const toolbar = page.getByRole("region", {
    name: "선택한 GitHub 항목 가져오기",
  });
  await expect(
    toolbar.getByRole("button", { name: "이미 모두 연결됨", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("선택: 연결 확인 2", { exact: true }).check();
  await toolbar
    .getByRole("button", { name: "선택 항목 프로젝트에 추가", exact: true })
    .click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual({
    project: "linked",
    items: ["demo/frontend#2"],
  });
});
