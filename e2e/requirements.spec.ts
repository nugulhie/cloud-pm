import { test, expect } from "@playwright/test";

test("PM이 PRD를 작성·편집하고 태스크 전환 및 GitHub 이슈 미리보기를 한다", async ({
  page,
}) => {
  test.setTimeout(60000);
  const name = `멤버 초대 PRD ${Date.now()}`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByText(
      "데모 워크스페이스 · 아래 작업자·PR·완료 상태는 예시 데이터입니다.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "PRD 관리", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "PRD 요구사항" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "전체 열 보기", exact: true }).click();
  for (const label of [
    "넘버링",
    "기능명",
    "상세설명",
    "정책",
    "비고",
    "상태",
    "최종 편집일시",
    "편집자",
    "담당자",
  ])
    await expect(
      page.getByRole("columnheader", { name: label, exact: true }),
    ).toBeAttached();
  await page.getByRole("button", { name: "＋ PRD 작성" }).click();
  const form = page.getByRole("dialog", { name: "PRD 작성", exact: true });
  await form.getByLabel("기능명", { exact: true }).fill(name);
  await form
    .getByLabel("상세설명", { exact: true })
    .fill("## 초대 사용자\n- 초대 링크를 통해 프로젝트에 참여한다.");
  await form
    .getByLabel("정책", { exact: true })
    .fill("초대 링크 유효기간은 **7일**이다.");
  await form.getByLabel("비고", { exact: true }).fill("초대 만료 안내 필요");
  await form.getByLabel("담당자", { exact: true }).selectOption("pm-developer");
  await form.getByLabel("상태", { exact: true }).selectOption("approved");
  await form.getByRole("button", { name: "PRD 저장" }).click();
  await expect(form).not.toBeVisible();
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
  await expect(row.getByText("승인", { exact: true })).toBeVisible();
  await expect(row.getByText("demo", { exact: true })).toBeAttached();
  await row.getByRole("button", { name, exact: true }).click();
  const edit = page.getByRole("dialog", { name: "PRD 항목 편집" });
  await edit
    .getByLabel("정책", { exact: true })
    .fill("조직 관리자만 초대할 수 있다. 유효기간은 7일.");
  await edit.getByRole("button", { name: "PRD 저장" }).click();
  await expect(edit).not.toBeVisible();
  await row.getByRole("checkbox").check();
  await page.getByRole("button", { name: "선택 항목 → 태스크" }).click();
  const convert = page.getByRole("dialog", { name: "PRD를 태스크로 전환" });
  await convert
    .getByRole("button", { name: "태스크 생성", exact: true })
    .click();
  await expect(convert).not.toBeVisible();
  await row.getByRole("button", { name: "태스크 열기" }).click();
  const task = page.getByRole("dialog", { name: "태스크 관리" });
  await task.getByRole("button", { name: "태스크 수정", exact: true }).click();
  await expect(task.getByLabel("담당자", { exact: true })).toHaveValue(
    "pm-developer",
  );
  await expect(task.getByLabel("설명", { exact: true })).toHaveValue(
    /조직 관리자만 초대/,
  );
  await task.getByRole("button", { name: "닫기", exact: true }).click();
  await row
    .getByRole("button", { name: "GitHub 이슈 생성", exact: true })
    .click();
  const issue = page.getByRole("dialog", {
    name: "GitHub 이슈 생성",
    exact: true,
  });
  await issue.getByRole("button", { name: "본문 미리보기" }).click();
  await expect(
    issue.getByRole("heading", { name: new RegExp(name), level: 3 }),
  ).toBeVisible();
  await expect(
    issue.getByRole("heading", { name: "정책", exact: true }),
  ).toBeVisible();
  await issue.getByRole("button", { name: "GitHub에 이슈 생성" }).click();
  await expect(issue.getByRole("alert")).toContainText(
    "데모에서는 실제 GitHub 이슈를 생성하지 않습니다.",
  );
  await issue.getByRole("button", { name: "취소", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  const scroll = page.getByRole("region", { name: "PRD 요구사항 표" });
  await scroll.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  expect(await scroll.evaluate((el) => el.scrollLeft > 0)).toBeTruthy();
  await page.screenshot({
    path: "test-results/prd-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("미전환 PRD도 이슈 생성 창에서 태스크 전환 후 미리보기로 이어진다", async ({
  page,
  request,
}) => {
  const id = `prd-issue-flow-${Date.now()}`,
    name = `바로 이슈 생성 ${Date.now()}`;
  const post = async (path: string, data: unknown) => {
    const response = await request.post(`/api/${path}`, { data });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  try {
    await post("projects", {
      data: { id, name: id, goal: "", repositories: ["demo/frontend"] },
    });
    await post("requirements", {
      data: {
        id: `${id}-prd`,
        project: id,
        featureName: name,
        description: "정책과 작업을 GitHub 이슈로 연결합니다.",
      },
    });
    await page.goto("/");
    await page.getByRole("button", { name: "PRD 관리", exact: true }).click();
    await page.getByLabel("프로젝트 필터").selectOption(id);
    const row = page
      .getByRole("row")
      .filter({ has: page.getByRole("button", { name, exact: true }) });
    await expect(row.getByText("태스크 미전환", { exact: true })).toBeVisible();
    await row
      .getByRole("button", { name: "GitHub 이슈 생성", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "GitHub 이슈 생성",
      exact: true,
    });
    await expect(dialog).toContainText("먼저 PRD를 태스크로 전환해 주세요.");
    let converted = 0,
      published = 0;
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path === "/api/requirements/convert") converted++;
      if (path === "/api/requirements/issue") published++;
    });
    await dialog
      .getByRole("button", { name: "태스크로 전환하고 계속", exact: true })
      .evaluate((element) => {
        (element as HTMLButtonElement).click();
        (element as HTMLButtonElement).click();
      });
    await expect(
      dialog.getByRole("button", { name: "본문 미리보기", exact: true }),
    ).toBeEnabled();
    await dialog
      .getByRole("button", { name: "본문 미리보기", exact: true })
      .click();
    await expect(dialog.locator(".prd-issue-preview")).toContainText(name);
    await expect(
      dialog.getByRole("button", { name: "GitHub에 이슈 생성", exact: true }),
    ).toBeEnabled();
    expect(converted).toBe(1);
    expect(published).toBe(0);
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
    await expect(
      row.getByRole("button", { name: "태스크 열기", exact: true }),
    ).toBeVisible();
    const snapshot = await (await request.get("/api/dashboard")).json();
    expect(
      snapshot.tasks.filter(
        (row: { data: { project: string } }) => row.data.project === id,
      ),
    ).toHaveLength(1);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  } finally {
    const data = await (await request.get("/api/dashboard")).json();
    const row = data.projects.find(
      (row: { data: { id: string } }) => row.data.id === id,
    );
    if (row)
      await request.post("/api/manage/delete", {
        data: { kind: "project", entries: [{ id, revision: row.revision }] },
      });
  }
});

test("이슈 대상 저장소가 없으면 이유와 프로젝트 저장소 설정 경로를 제공한다", async ({
  page,
  request,
}) => {
  const id = `prd-no-repo-${Date.now()}`,
    name = `저장소 연결 필요 ${Date.now()}`;
  try {
    expect(
      (
        await request.post("/api/projects", {
          data: { data: { id, name: id, goal: "", repositories: [] } },
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await request.post("/api/requirements", {
          data: { data: { id: `${id}-prd`, project: id, featureName: name } },
        })
      ).ok(),
    ).toBeTruthy();
    await page.goto("/");
    await page.getByRole("button", { name: "PRD 관리", exact: true }).click();
    await page.getByLabel("프로젝트 필터").selectOption(id);
    const row = page
      .getByRole("row")
      .filter({ has: page.getByRole("button", { name, exact: true }) });
    await row
      .getByRole("button", { name: "GitHub 이슈 생성", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "GitHub 이슈 생성",
      exact: true,
    });
    await expect(dialog).toContainText(
      "프로젝트에 연결된 GitHub 저장소가 없습니다.",
    );
    await dialog
      .getByRole("button", { name: "태스크로 전환하고 계속", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "본문 미리보기", exact: true }),
    ).toBeDisabled();
    await dialog
      .getByRole("button", { name: "프로젝트 저장소 설정", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel("관리 종류")).toHaveValue("project");
    await expect(page.getByLabel("프로젝트 필터")).toHaveValue(id);
    await expect(page.locator(".management-row")).toHaveCount(1);
  } finally {
    const data = await (await request.get("/api/dashboard")).json();
    const row = data.projects.find(
      (row: { data: { id: string } }) => row.data.id === id,
    );
    if (row)
      await request.post("/api/manage/delete", {
        data: { kind: "project", entries: [{ id, revision: row.revision }] },
      });
  }
});
