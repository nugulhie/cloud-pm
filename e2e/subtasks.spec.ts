import { test, expect } from "@playwright/test";

test("Asana 하위 작업을 계층으로 펼치고 추가·중첩·직접 완료·재개방·일괄 완료한다", async ({
  page,
  request,
}) => {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  const name = `하위 작업 ${Date.now()}`;
  let project = "";
  try {
    const input = {
      fileName: `${name}.json`,
      format: "json",
      content: JSON.stringify({
        project: { gid: String(Date.now()), name },
        tasks: [
          {
            gid: "1",
            name: "출시 준비",
            subtasks: [
              {
                gid: "2",
                name: "정책 확인",
                subtasks: [{ gid: "3", name: "약관 문구" }],
              },
            ],
          },
        ],
      }),
    };
    const preview = await (
      await request.post("/api/projects/import/asana/preview", { data: input })
    ).json();
    const response = await request.post("/api/projects/import/asana", {
      data: {
        ...input,
        previewHash: preview.previewHash,
        mode: "skip",
        ids: ["1", "2", "3"],
      },
    });
    expect(response.ok()).toBeTruthy();
    project = (await response.json()).project;
    const data = await (await request.get("/api/dashboard")).json();
    const parent = data.tasks.find(
      (row: { data: { project: string; title: string } }) =>
        row.data.project === project && row.data.title === "출시 준비",
    );
    const child = data.tasks.find(
      (row: { data: { project: string; title: string } }) =>
        row.data.project === project && row.data.title === "정책 확인",
    );
    const grandchild = data.tasks.find(
      (row: { data: { project: string; title: string } }) =>
        row.data.project === project && row.data.title === "약관 문구",
    );
    await page.goto("/");
    await page
      .getByRole("button", { name: "태스크 보드", exact: true })
      .click();
    await page.getByLabel("프로젝트 필터").selectOption(project);
    await page.getByRole("button", { name: "계층 보기", exact: true }).click();
    const tree = page.getByRole("region", { name: "태스크 계층 보기" });
    const rootRow = tree.locator(`[data-task-id="${parent.data.id}"]`);
    const childRow = tree.locator(`[data-task-id="${child.data.id}"]`);
    await expect(tree.locator(".task-hierarchy-row")).toHaveCount(1);
    await rootRow
      .getByRole("button", {
        name: "출시 준비 하위 태스크 펼치기",
        exact: true,
      })
      .click();
    await expect(childRow).toHaveAttribute("data-depth", "1");
    await childRow
      .getByRole("button", {
        name: "정책 확인 하위 태스크 펼치기",
        exact: true,
      })
      .click();
    await expect(
      tree.locator(`[data-task-id="${grandchild.data.id}"]`),
    ).toHaveAttribute("data-depth", "2");
    await childRow.getByLabel("정책 확인 완료", { exact: true }).check();
    await expect(
      childRow.getByLabel("정책 확인 완료", { exact: true }),
    ).toBeChecked();
    await expect(rootRow).toContainText("하위 1 / 1개 완료");
    await expect(
      rootRow.getByLabel("출시 준비 완료", { exact: true }),
    ).not.toBeChecked();
    await expect(
      tree.getByLabel("약관 문구 완료", { exact: true }),
    ).not.toBeChecked();
    await rootRow
      .getByRole("button", { name: "출시 준비 하위 태스크 추가", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "태스크 관리" });
    await expect(dialog.getByLabel("상위 태스크", { exact: true })).toHaveValue(
      parent.data.id,
    );
    await expect(dialog.getByLabel("제목", { exact: true })).toBeFocused();
    await dialog.getByLabel("제목", { exact: true }).fill("출시 공지");
    await dialog
      .getByLabel("담당자", { exact: true })
      .selectOption("pm-developer");
    await dialog.getByLabel("기한", { exact: true }).fill("2026-11-30");
    await dialog.getByLabel("상태", { exact: true }).selectOption("done");
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      tree.getByLabel("출시 공지 완료", { exact: true }),
    ).toBeChecked();
    await rootRow.locator(".task-hierarchy-title").click();
    const subtasks = dialog.getByRole("region", { name: "하위 태스크 관리" });
    await expect(subtasks).toContainText("2 / 2 완료");
    await subtasks
      .locator(".task-subtask-open")
      .filter({ hasText: "정책 확인" })
      .click();
    await expect(dialog.locator(".task-detail-title")).toHaveText("정책 확인");
    await expect(
      dialog.getByRole("region", { name: "하위 태스크 관리" }),
    ).toContainText("약관 문구");
    await dialog
      .getByRole("button", { name: "＋ 하위 태스크 추가", exact: true })
      .click();
    await expect(dialog.getByLabel("상위 태스크", { exact: true })).toHaveValue(
      child.data.id,
    );
    await dialog.getByLabel("제목", { exact: true }).fill("중첩 검토");
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const nested = tree
      .locator(".task-hierarchy-row")
      .filter({ hasText: "중첩 검토" });
    await expect(nested).toHaveAttribute("data-depth", "2");
    await nested.getByLabel("중첩 검토 완료", { exact: true }).check();
    await expect(
      nested.getByLabel("중첩 검토 완료", { exact: true }),
    ).toBeChecked();
    await nested.getByLabel("중첩 검토 완료", { exact: true }).uncheck();
    await expect(
      nested.getByLabel("중첩 검토 완료", { exact: true }),
    ).not.toBeChecked();
    const failStatus = async (route: import("@playwright/test").Route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "상태 변경 충돌입니다. 다시 확인하세요.",
        }),
      });
    await page.route("**/api/tasks", failStatus);
    await nested.getByLabel("중첩 검토 완료", { exact: true }).click();
    await expect(page.locator('.alert[role="alert"]')).toContainText(
      "상태 변경 충돌",
    );
    await expect(
      nested.getByLabel("중첩 검토 완료", { exact: true }),
    ).not.toBeChecked();
    await page.unroute("**/api/tasks", failStatus);
    await page.getByRole("button", { name: "새로고침", exact: true }).click();
    await expect(page.locator('.alert[role="alert"]')).toHaveCount(0);
    await page.screenshot({
      path: ".data/ux-review/task-hierarchy-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: ".data/ux-review/task-hierarchy-mobile.png",
      fullPage: true,
    });
    await page
      .getByRole("textbox", { name: "태스크 검색", exact: true })
      .fill("중첩 검토");
    await expect(tree.locator(".task-hierarchy-row")).toHaveCount(1);
    await expect(tree).toContainText("상위: 정책 확인");
    await page
      .getByRole("textbox", { name: "태스크 검색", exact: true })
      .fill("");
    await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
    await page.getByRole("button", { name: "항목 관리", exact: true }).click();
    await page.getByLabel("관리 종류").selectOption("task");
    await page
      .getByRole("button", { name: "전체 선택 (최대 100개)", exact: true })
      .click();
    await page.getByText("선택 항목 일괄 수정", { exact: true }).click();
    await page.getByLabel("변경 필드", { exact: true }).selectOption("status");
    await page
      .locator('.management-form select[name="value"]')
      .selectOption("done");
    await page
      .getByRole("button", { name: "선택 5개 수정", exact: true })
      .click();
    await expect(
      page.locator(".management-panel").getByRole("status"),
    ).toContainText("저장했습니다");
    const after = await (await request.get("/api/dashboard")).json();
    expect(
      after.tasks.filter(
        (row: { data: { project: string; status: string } }) =>
          row.data.project === project && row.data.status === "done",
      ),
    ).toHaveLength(5);
  } finally {
    if (project && test.info().status !== "timedOut") {
      const current = await (await request.get("/api/dashboard")).json();
      const row = current.projects.find(
        (entry: { data: { id: string } }) => entry.data.id === project,
      );
      if (row)
        expect(
          (
            await request.post("/api/manage/delete", {
              data: {
                kind: "project",
                entries: [{ id: project, revision: row.revision }],
              },
            })
          ).ok(),
        ).toBeTruthy();
    }
  }
});
