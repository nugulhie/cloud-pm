import { test, expect } from "@playwright/test";
test("정책과 용어집을 작성·편집·검색하고 PRD에서 참조한다", async ({
  page,
  request,
}) => {
  const suffix = Date.now(),
    policyName = `초대 정책 ${suffix}`,
    termName = `초대 ${suffix}`;
  await page.goto("/");
  await page.getByRole("button", { name: "정책 저장소", exact: true }).click();
  await page.getByRole("button", { name: "＋ 정책 등록" }).click();
  const policy = page.getByRole("dialog", { name: "정책 등록", exact: true });
  await policy.getByLabel("정책명", { exact: true }).fill(policyName);
  await policy.getByLabel("분류", { exact: true }).fill("계정");
  await policy
    .getByLabel("정책 내용", { exact: true })
    .fill("## 초대 규칙\n초대 링크는 **7일**간 유효하다.");
  await policy.getByLabel("상태", { exact: true }).selectOption("active");
  await policy.getByRole("button", { name: "정책 저장" }).click();
  await expect(policy).not.toBeVisible();
  await page.getByRole("textbox", { name: "정책 검색" }).fill(policyName);
  const card = page.locator(".knowledge-card").filter({
    has: page.getByRole("heading", { name: policyName, exact: true }),
  });
  await card.getByText("정책 내용 보기", { exact: true }).click();
  await expect(card.getByRole("heading", { name: "초대 규칙" })).toBeVisible();
  await page.getByRole("button", { name: "용어집", exact: true }).click();
  await page.getByRole("button", { name: "＋ 용어 등록" }).click();
  const term = page.getByRole("dialog", { name: "용어 등록", exact: true });
  await term.getByLabel("용어명", { exact: true }).fill(termName);
  await term.getByLabel("별칭·약어", { exact: true }).fill("Invitation, 초청");
  await term
    .getByLabel("정의", { exact: true })
    .fill("워크스페이스 참여 권한을 전달하는 절차");
  await term.getByRole("button", { name: "용어 저장" }).click();
  await expect(term).not.toBeVisible();
  await page.getByRole("textbox", { name: "용어 검색" }).fill(termName);
  await expect(
    page.getByRole("heading", { name: termName, exact: true }),
  ).toBeVisible();
  const glossary = page.locator(".knowledge-card").filter({
    has: page.getByRole("heading", { name: termName, exact: true }),
  });
  await glossary.getByRole("button", { name: "편집", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "용어 편집", exact: true });
  await edit
    .getByLabel("정의", { exact: true })
    .fill("멤버에게 워크스페이스 참여 권한을 전달하는 절차");
  await edit.getByRole("button", { name: "용어 저장" }).click();
  await expect(edit).not.toBeVisible();
  await page.getByRole("button", { name: "PRD 관리", exact: true }).click();
  await page.getByRole("button", { name: "＋ PRD 작성" }).click();
  const prd = page.getByRole("dialog", { name: "PRD 작성", exact: true });
  await prd.getByLabel("기능명", { exact: true }).fill(`정책 연결 ${suffix}`);
  await prd
    .getByLabel("관련 정책", { exact: true })
    .selectOption({ label: policyName });
  await prd
    .getByLabel("관련 용어", { exact: true })
    .selectOption({ label: termName });
  await prd.getByRole("button", { name: "PRD 저장" }).click();
  await expect(prd).not.toBeVisible();
  await page.getByRole("button", { name: "전체 열 보기", exact: true }).click();
  await expect(
    page.getByText(`참조: ${policyName}`, { exact: true }),
  ).toBeVisible();
  const data = await (await request.get("/api/dashboard")).json();
  const policyRow = data.knowledge.find(
    (r: { data: { name: string } }) => r.data.name === policyName,
  );
  const response = await request.post("/api/knowledge/delete", {
    data: { id: policyRow.data.id, revision: policyRow.revision },
  });
  expect(response.status()).toBe(400);
  await page.getByRole("button", { name: "변경 이력", exact: true }).click();
  await page
    .getByRole("combobox", { name: "변경 종류" })
    .selectOption("knowledge");
  await expect(
    page
      .locator(".history-event")
      .getByRole("heading", { name: policyName, exact: true }),
  ).toBeVisible();
});
