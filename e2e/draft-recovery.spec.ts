import { test, expect } from "@playwright/test";

test("정책 선택과 검색만 한 경우 초안 변경으로 처리하지 않는다", async ({
  page,
  request,
}) => {
  const name = `변경 없는 정책 ${Date.now()}`;
  const created = await request.post("/api/knowledge", {
    data: {
      data: {
        id: `draft-nochange-${Date.now()}`,
        kind: "policy",
        name,
        content: "선택 검색 검증",
      },
    },
  });
  expect(created.ok()).toBeTruthy();
  await page.goto("/");
  await expect(page.getByLabel("프로젝트 필터", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "정책 저장소", exact: true }).click();
  await page
    .locator(".knowledge-card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .getByRole("button", { name: "편집", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "정책 편집", exact: true });
  await dialog
    .getByRole("button", { name: "기준 정책 선택", exact: true })
    .click();
  await dialog
    .getByRole("searchbox", { name: "따르는 정책 검색", exact: true })
    .fill("선택하지 않는 검색");
  await dialog
    .getByRole("button", { name: "닫기", exact: true })
    .last()
    .click();
  await expect(dialog).not.toBeVisible();
});

test("프로젝트 저장소를 검색해 숨긴 선택도 초안 복원과 저장에 유지한다", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("프로젝트 필터", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "프로젝트 만들기", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
      name: "프로젝트 등록",
      exact: true,
    }),
    name = `검색 중 저장소 초안 ${Date.now()}`;
  await dialog.getByLabel("프로젝트 이름", { exact: true }).fill(name);
  for (const repo of ["demo/backend", "demo/frontend"])
    await dialog.getByRole("checkbox", { name: repo, exact: true }).check();
  await dialog
    .getByRole("textbox", { name: "저장소 검색", exact: true })
    .fill("frontend");
  await dialog
    .getByLabel("프로젝트 목표", { exact: true })
    .fill("검색으로 숨겨진 저장소도 복원");
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await dialog
    .getByRole("button", { name: "초안 보관하고 닫기", exact: true })
    .click();
  await page
    .getByRole("button", { name: "프로젝트 만들기", exact: true })
    .click();
  await dialog.getByRole("button", { name: "초안 복원", exact: true }).click();
  await expect(dialog.getByLabel("프로젝트 이름", { exact: true })).toHaveValue(
    name,
  );
  for (const repo of ["demo/backend", "demo/frontend"])
    await expect(
      dialog.getByRole("checkbox", { name: repo, exact: true }),
    ).toBeChecked();
  await dialog
    .getByRole("button", { name: "프로젝트 생성", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const dashboard = await (await request.get("/api/dashboard")).json();
  expect(
    dashboard.projects
      .find((p: any) => p.data.name === name)
      .data.repositories.sort(),
  ).toEqual(["demo/backend", "demo/frontend"]);
});
