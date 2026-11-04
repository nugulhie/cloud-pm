import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("프로젝트 5자리 식별자와 GitHub 사용자 선택·조회 재시도·저장소별 이슈 담당자를 연결한다", async ({
  page,
  request,
}) => {
  const id = `github-people-${randomUUID()}`,
    prefix = randomUUID().replaceAll("-", "").slice(0, 5).toUpperCase();
  const name = `GitHub 담당자 ${Date.now()}`;
  const seed = await request.post("/api/projects", {
    data: {
      data: {
        id,
        name,
        goal: "",
        featurePrefix: prefix,
        repositories: ["demo/backend", "demo/frontend"],
      },
    },
  });
  expect(seed.ok()).toBeTruthy();
  let allowLookup = false;
  await page.route("**/api/github/assignees?**", async (route) => {
    const repo = new URL(route.request().url()).searchParams.get("repository");
    if (!repo && !allowLookup)
      return route.fulfill({
        status: 502,
        json: { error: "GitHub 담당자 일시 연결 실패" },
      });
    const logins =
      repo === "demo/frontend"
        ? ["frontend-dev"]
        : repo === "demo/backend"
          ? ["backend-dev"]
          : ["backend-dev", "frontend-dev"];
    return route.fulfill({
      json: {
        users: logins.map((login) => ({
          login,
          repositories: [repo ?? "demo/backend"],
        })),
        repositories: repo ? [repo] : ["demo/backend", "demo/frontend"],
      },
    });
  });
  await page.goto("/");
  await page.getByRole("combobox", { name: "프로젝트 필터" }).selectOption(id);
  await page.getByRole("button", { name: "PRD 관리", exact: true }).click();
  await page.getByRole("button", { name: "＋ PRD 작성", exact: true }).click();
  const form = page.getByRole("dialog", { name: "PRD 작성", exact: true });
  await form.getByLabel("기능명", { exact: true }).fill(name);
  await expect(form.getByRole("alert")).toContainText("일시 연결 실패");
  allowLookup = true;
  await form.getByRole("button", { name: "담당자 다시 불러오기" }).click();
  const assignee = form.getByRole("combobox", { name: "담당자", exact: true });
  await expect(assignee.locator("option")).toHaveText([
    "미지정",
    "@backend-dev",
    "@frontend-dev",
  ]);
  await expect(form.locator('input[name="assignee"]')).toHaveAttribute(
    "type",
    "hidden",
  );
  await assignee.selectOption("backend-dev");
  await form.getByRole("button", { name: "PRD 저장", exact: true }).click();
  await expect(form).toHaveCount(0);
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
  await expect(row.locator("td strong")).toHaveText(`${prefix}-001`);
  await expect(row).toContainText("backend-dev");
  await row
    .getByRole("button", { name: "GitHub 이슈 생성", exact: true })
    .click();
  const issue = page.getByRole("dialog", {
    name: "GitHub 이슈 생성",
    exact: true,
  });
  await issue.getByRole("button", { name: "태스크로 전환하고 계속" }).click();
  await issue
    .getByRole("combobox", { name: "이슈 대상 저장소" })
    .selectOption("demo/frontend");
  await expect(
    issue.getByRole("button", { name: "본문 미리보기" }),
  ).toBeDisabled();
  const target = issue.getByRole("combobox", { name: "GitHub 이슈 담당자" });
  await target.selectOption("frontend-dev");
  await issue.getByRole("button", { name: "본문 미리보기" }).click();
  await expect(
    issue.getByRole("heading", { level: 3, name: `[${prefix}-001] ${name}` }),
  ).toBeVisible();
  await expect(issue.locator(".prd-issue-preview")).toContainText(
    "담당자: frontend-dev",
  );
  const issued = page.waitForRequest(
    (req) =>
      new URL(req.url()).pathname === "/api/requirements/issue" &&
      req.method() === "POST",
  );
  await issue.getByRole("button", { name: "GitHub에 이슈 생성" }).click();
  expect((await issued).postDataJSON().assignee).toBe("frontend-dev");
  await expect(issue.getByRole("alert")).toContainText("데모에서는");
});

test("프로젝트 생성 시 식별자를 자동 생성·직접 지정하고 중복 입력을 안내한다", async ({
  page,
  request,
}) => {
  const suffix = randomUUID().slice(0, 8),
    prefix = randomUUID().replaceAll("-", "").slice(0, 5).toUpperCase();
  const duplicate = await request.post("/api/projects", {
    data: {
      data: {
        id: `prefix-seed-${suffix}`,
        name: "기존 식별자",
        goal: "",
        repositories: ["demo/backend"],
        featurePrefix: prefix,
      },
    },
  });
  expect(duplicate.ok()).toBeTruthy();
  await page.goto("/");
  await page
    .getByRole("button", { name: "＋ 프로젝트 만들기", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "프로젝트 등록" });
  await dialog
    .getByLabel("프로젝트 이름", { exact: true })
    .fill(`새 프로젝트 ${suffix}`);
  const code = dialog.getByRole("textbox", {
    name: "기능 식별자 (5자리)",
    exact: true,
  });
  await expect(code).toHaveValue(/^[A-Z0-9]{5}$/);
  await code.fill(prefix);
  await dialog
    .getByRole("checkbox", { name: "demo/backend", exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "프로젝트 생성", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "다른 프로젝트에서 사용 중",
  );
  await dialog
    .getByRole("button", { name: "식별자 자동 생성", exact: true })
    .click();
  await expect(code).not.toHaveValue(prefix);
  const generated = await code.inputValue();
  await dialog
    .getByRole("button", { name: "프로젝트 생성", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const data = await (await request.get("/api/dashboard")).json();
  expect(
    data.projects.find((p: any) => p.data.name === `새 프로젝트 ${suffix}`).data
      .featurePrefix,
  ).toBe(generated);
});
