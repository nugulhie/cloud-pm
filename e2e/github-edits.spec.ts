import { test, expect, type Page } from "@playwright/test";
function item(number: number, kind: "issue" | "pr") {
  return {
    id: `demo/frontend#${number}`,
    repository: "demo/frontend",
    number,
    kind,
    title: `수정 전 ${kind} ${number}`,
    body: "# 이전 본문",
    author: "dev",
    assignees: ["old-owner"],
    reviewers: [],
    labels: [{ name: "old-label", color: "aaaaff" }],
    state: "open",
    url: `https://github.com/demo/frontend/${kind === "pr" ? "pull" : "issues"}/${number}`,
    updatedAt: "2026-11-03T00:00:00Z",
    ...(kind === "pr"
      ? {
          headSha: "a".repeat(40),
          filesComplete: true,
          files: [
            {
              path: "src/old.ts",
              status: "modified",
              additions: 1,
              deletions: 0,
              patch: "@@ -0,0 +1 @@\n+old",
            },
          ],
        }
      : {}),
  };
}
async function dashboard(page: Page, items: ReturnType<typeof item>[]) {
  await page.route("**/api/dashboard", async (route) => {
    const data = await (await route.fetch()).json();
    data.items = items.map((data) => ({
      data,
      revision: 1,
      updatedAt: data.updatedAt,
    }));
    await route.fulfill({ json: data });
  });
}
for (const kind of ["issue", "pr"] as const) {
  test(`${kind} 상세는 열 때와 열린 상태에서 편집 내용을 갱신하고 원문 탭을 유지한다`, async ({
    page,
  }) => {
    const old = item(9991, kind);
    let fresh = { ...old };
    let reads = 0;
    await dashboard(page, [old]);
    await page.route("**/api/github/item?**", async (route) => {
      reads++;
      await route.fulfill({ json: fresh });
    });
    await page.goto("/");
    await page
      .getByRole("button", { name: "GitHub 활동", exact: true })
      .click();
    fresh = {
      ...old,
      title: "GitHub에서 바뀐 제목",
      body: "## 수정된 본문\n\n새로운 설명",
      assignees: ["new-owner"],
      labels: [{ name: "hotfix", color: "ff0000" }],
      updatedAt: "2026-11-04T00:00:00Z",
    };
    await page.clock.install();
    await page.locator(".activity-row").filter({ hasText: old.title }).click();
    const dialog = page.getByRole("dialog", { name: "PR 및 파일 변경" });
    await expect(
      dialog.getByRole("heading", { name: fresh.title, exact: true }),
    ).toBeVisible();
    await expect(dialog).toContainText("new-owner");
    await expect(dialog).toContainText("hotfix");
    await expect(
      dialog.getByRole("heading", { name: "수정된 본문", exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("tab", { name: "Markdown 원문", exact: true })
      .click();
    fresh = {
      ...fresh,
      title: "두 번째 수정",
      body: "## 두 번째 본문",
      assignees: [],
      labels: [],
      updatedAt: "2026-11-04T00:01:00Z",
      ...(kind === "pr"
        ? {
            headSha: "b".repeat(40),
            files: [
              {
                path: "src/new.ts",
                status: "modified",
                additions: 1,
                deletions: 0,
                patch: "@@ -0,0 +1 @@\n+new",
              },
            ],
          }
        : {}),
    };
    await page.clock.fastForward(15100);
    await expect(
      dialog.getByRole("heading", { name: "두 번째 수정", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("tab", { name: "Markdown 원문", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(dialog.locator(".markdown-source")).toContainText(
      "두 번째 본문",
    );
    await expect(dialog).not.toContainText("hotfix");
    await expect(dialog).not.toContainText("new-owner");
    if (kind === "pr") {
      await expect(dialog).toContainText("src/new.ts");
      await expect(dialog).not.toContainText("src/old.ts");
    }
    await dialog
      .getByRole("button", { name: "최신 내용 새로고침", exact: true })
      .click();
    await expect.poll(() => reads).toBeGreaterThanOrEqual(3);
    await dialog.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(
      page.locator(".activity-row").filter({ hasText: "두 번째 수정" }),
    ).toBeVisible();
  });
}

test("상세 갱신 실패는 재시도할 수 있고 접근 권한이 사라지면 상세를 닫는다", async ({
  page,
}) => {
  const old = item(9992, "issue");
  let status = 500;
  await dashboard(page, [old]);
  await page.route("**/api/github/item?**", (route) =>
    route.fulfill(
      status === 200
        ? { json: { ...old, title: "재시도 성공" } }
        : {
            status,
            json: {
              error:
                status === 403
                  ? "이 항목에 접근할 수 없습니다."
                  : "일시적 오류",
            },
          },
    ),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "GitHub 활동", exact: true }).click();
  await page.locator(".activity-row").filter({ hasText: old.title }).click();
  const dialog = page.getByRole("dialog", { name: "PR 및 파일 변경" });
  await expect(dialog.getByRole("alert")).toContainText("일시적 오류");
  status = 200;
  await dialog.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "재시도 성공", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  status = 403;
  const reloaded = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/dashboard",
  );
  await dialog
    .getByRole("button", { name: "최신 내용 새로고침", exact: true })
    .click();
  await reloaded;
  await expect(dialog).toHaveCount(0);
});

test("다른 항목으로 이동한 뒤 도착한 오래된 응답은 새 상세를 덮어쓰지 않는다", async ({
  page,
}) => {
  const first = item(9993, "issue"),
    second = item(9994, "issue");
  await dashboard(page, [first, second]);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let firstRequested = false;
  await page.route("**/api/github/item?**", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    if (id === first.id) {
      firstRequested = true;
      await held;
      await route
        .fulfill({ json: { ...first, title: "지연된 이전 응답" } })
        .catch(() => {});
    } else
      await route.fulfill({ json: { ...second, title: "현재 선택한 이슈" } });
  });
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: "GitHub 활동", exact: true })
      .click();
    await page
      .locator(".activity-row")
      .filter({ hasText: first.title })
      .click();
    await expect.poll(() => firstRequested).toBeTruthy();
    const dialog = page.getByRole("dialog", { name: "PR 및 파일 변경" });
    await dialog.getByRole("button", { name: "닫기", exact: true }).click();
    await page
      .locator(".activity-row")
      .filter({ hasText: second.title })
      .click();
    await expect(
      dialog.getByRole("heading", { name: "현재 선택한 이슈", exact: true }),
    ).toBeVisible();
    release();
    await expect(dialog).not.toContainText("지연된 이전 응답");
  } finally {
    release();
  }
});
