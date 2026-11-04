import { test, expect } from "@playwright/test";

test("프로젝트 현황에서 삭제 범위를 확인하고 취소·충돌·재시도·연쇄 삭제한다", async ({
  page,
  request,
}) => {
  const id = `project-delete-${Date.now()}`;
  const name = `프로젝트 삭제 검증 ${Date.now()}`;
  const snapshot = async () => (await request.get("/api/dashboard")).json();
  let requests = 0,
    nativeDialogs = 0,
    conflict = false;
  page.on("dialog", async (dialog) => {
    nativeDialogs++;
    await dialog.dismiss();
  });
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  try {
    expect(
      (
        await request.post("/api/projects", {
          data: { data: { id, name, goal: "검증용", repositories: [] } },
        })
      ).ok(),
    ).toBeTruthy();
    for (const [suffix, parent] of [
      ["parent", null],
      ["child", "parent"],
      ["grandchild", "child"],
    ]) {
      expect(
        (
          await request.post("/api/tasks", {
            data: {
              data: {
                id: `${id}-${suffix}`,
                project: id,
                title: `${name} ${suffix}`,
                parentId: parent ? `${id}-${parent}` : null,
              },
            },
          })
        ).ok(),
      ).toBeTruthy();
    }
    expect(
      (
        await request.post("/api/requirements", {
          data: {
            data: { id: `${id}-prd`, project: id, featureName: "삭제할 PRD" },
          },
        })
      ).ok(),
    ).toBeTruthy();
    const before = await snapshot();
    await page.route("**/api/manage/delete", async (route) => {
      requests++;
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (conflict)
        await route.fulfill({
          status: 409,
          json: { error: "다른 요청이 변경했습니다. 새로고침하세요." },
        });
      else await route.continue();
    });
    await page.goto("/");
    await page.getByLabel("프로젝트 필터").selectOption(id);
    await page
      .getByRole("button", { name: "프로젝트 관리", exact: true })
      .click();
    await expect(page.getByLabel("관리 종류")).toHaveValue("project");
    await expect(page.locator(".management-row")).toHaveCount(1);
    await expect(page.locator(".management-row")).toContainText(name);
    await page
      .getByRole("button", { name: "프로젝트 현황", exact: true })
      .click();
    const row = page.locator(`[data-project-id="${id}"]`);
    await row
      .getByRole("button", { name: `${name} 프로젝트 삭제`, exact: true })
      .click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toHaveCount(1);
    await expect(dialog).toContainText(name);
    await expect(dialog).toContainText("작업 3개 · PRD 1개");
    await expect(
      dialog.getByRole("button", { name: "취소", exact: true }),
    ).toBeFocused();
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(requests).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    conflict = true;
    await page.locator(".overview-tools > summary").click();
    await page
      .getByRole("button", { name: "프로젝트 삭제", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "삭제 확인", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "다른 요청이 변경했습니다.",
    );
    expect(
      (await snapshot()).tasks.filter(
        (task: { data: { project: string } }) => task.data.project === id,
      ),
    ).toHaveLength(3);
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
    conflict = false;
    await page
      .getByRole("button", { name: "프로젝트 삭제", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "삭제 확인", exact: true })
      .evaluate((element) => {
        (element as HTMLButtonElement).click();
        (element as HTMLButtonElement).click();
      });
    await expect(dialog).toHaveCount(0);
    await expect(row).toHaveCount(0);
    await expect(page.getByLabel("프로젝트 필터")).toHaveValue("");
    await expect(page.locator(".action-notice")).toContainText(
      "프로젝트와 연결된 작업을 삭제했습니다.",
    );
    const after = await snapshot();
    for (const kind of ["features", "tasks", "requirements"])
      expect(
        after[kind].filter(
          (row: { data: { project: string } }) => row.data.project === id,
        ),
      ).toHaveLength(0);
    expect(
      after.items.map((row: { data: { id: string } }) => row.data.id),
    ).toEqual(before.items.map((row: { data: { id: string } }) => row.data.id));
    expect(requests).toBe(2);
    expect(nativeDialogs).toBe(0);
  } finally {
    const row = (await snapshot()).projects.find(
      (row: { data: { id: string } }) => row.data.id === id,
    );
    if (row)
      await request.post("/api/manage/delete", {
        data: { kind: "project", entries: [{ id, revision: row.revision }] },
      });
  }
});
