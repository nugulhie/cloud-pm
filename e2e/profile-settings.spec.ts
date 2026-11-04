import { test, expect, type Page } from "@playwright/test";
async function mockAccount(page: Page, writable = true) {
  let issued = 0;
  let profile = {
    id: "settings-user",
    login: "planner",
    displayName: "기획자",
    githubConnected: false,
    githubTokenLast4: "",
    repositoryCount: 0,
    serviceTokenLast4: null as string | null,
    serviceTokenRole: "read",
    serviceTokenWorkspaceId: "main",
  };
  await page.route("**/api/auth/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      route.request().method() === "POST" ? route.request().postDataJSON() : {};
    if (path.endsWith("/me"))
      return route.fulfill({
        json: { user: profile, effectiveRole: writable ? "write" : "read" },
      });
    if (path.endsWith("/workspaces"))
      return route.fulfill({
        json: {
          currentId: "main",
          workspaces: [{ id: "main", name: "기본 공간", role: "owner" }],
        },
      });
    if (path.endsWith("/workspace"))
      return route.fulfill({
        json: {
          id: "main",
          name: "기본 공간",
          organization: "org",
          admin: false,
          role: writable ? "member" : "viewer",
          members: [],
          invites: [],
          githubConnection: {
            kind: "app",
            appId: "1234",
            login: "GitHub App #1234",
            repositoryCount: 3,
          },
        },
      });
    if (path.endsWith("/profile")) {
      profile = {
        ...profile,
        displayName: body.displayName,
        ...(body.githubToken
          ? {
              githubConnected: true,
              githubTokenLast4: body.githubToken.slice(-4),
            }
          : {}),
      };
      return route.fulfill({ json: { user: profile } });
    }
    if (path.endsWith("/service-token")) {
      issued++;
      profile = {
        ...profile,
        serviceTokenLast4: "5678",
        serviceTokenRole: body.role,
      };
      return route.fulfill({ json: { token: "cpm_fake_settings_5678" } });
    }
    if (path.endsWith("/revoke-service-token")) {
      profile = { ...profile, serviceTokenLast4: null };
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith("/mcp/status"))
      return route.fulfill({
        json: {
          workspace: { id: "main", name: "기본 공간" },
          effectiveRole: writable ? "write" : "read",
          publicHttps: false,
          url: "http://127.0.0.1:3100/api/mcp",
          token: {
            exists: !!profile.serviceTokenLast4,
            currentWorkspace: true,
          },
          lastConnection: null,
        },
      });
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  if ((page.viewportSize()?.width ?? 1440) <= 720)
    await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
  await page.getByRole("button", { name: "개인 프로필 및 토큰 설정" }).click();
  return {
    dialog: page.getByRole("dialog", { name: "프로필 및 토큰 설정" }),
    issued: () => issued,
  };
}

test("설정 탭에서 프로필·GitHub·MCP를 구분하고 입력·발급 토큰을 보존한다", async ({
  page,
}) => {
  const { dialog, issued } = await mockAccount(page);
  await expect(
    dialog.getByRole("tab", { name: "프로필", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("tabpanel")).toHaveCount(1);
  await page.screenshot({
    path: ".data/ux-review/profile-settings-desktop.png",
  });
  await dialog.getByLabel("표시 이름", { exact: true }).fill("작성 중인 이름");
  await dialog.getByRole("tab", { name: "GitHub 연결", exact: true }).click();
  await dialog
    .getByLabel("개인 GitHub 연결 (선택)", { exact: true })
    .fill("fake_github_1234");
  await dialog
    .getByRole("button", { name: "GitHub 연결 저장", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("저장했습니다");
  await dialog.getByRole("tab", { name: "프로필", exact: true }).click();
  await expect(dialog.getByLabel("표시 이름", { exact: true })).toHaveValue(
    "작성 중인 이름",
  );
  await dialog
    .getByRole("button", { name: "프로필 저장", exact: true })
    .click();
  await expect(dialog.locator(".profile-summary")).toContainText(
    "조직 GitHub App 연결 · 저장소 3개",
  );
  await dialog.getByRole("tab", { name: "MCP·API", exact: true }).click();
  await dialog
    .getByRole("button", { name: "조회 전용 토큰 발급", exact: true })
    .click();
  await expect(
    dialog.getByLabel("새 서비스 토큰", { exact: true }),
  ).toHaveValue("cpm_fake_settings_5678");
  await dialog.getByRole("tab", { name: "워크스페이스", exact: true }).click();
  await expect(
    dialog.getByRole("heading", {
      name: "워크스페이스 멤버·초대",
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByRole("tab", { name: "MCP·API", exact: true }).click();
  await expect(
    dialog.getByLabel("새 서비스 토큰", { exact: true }),
  ).toHaveValue("cpm_fake_settings_5678");
  expect(issued()).toBe(1);
  await dialog.getByRole("tab", { name: "프로필", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(
    dialog.getByRole("tab", { name: "보안", exact: true }),
  ).toBeFocused();
  await expect(
    dialog.getByLabel("현재 비밀번호", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Home");
  await expect(
    dialog.getByRole("tab", { name: "프로필", exact: true }),
  ).toBeFocused();
});

test("모바일 설정은 가로 탭과 내부 스크롤을 제공하고 조회 권한은 유지한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { dialog } = await mockAccount(page, false);
  await expect(
    dialog.getByRole("tablist", { name: "설정 메뉴" }),
  ).toHaveAttribute("aria-orientation", "horizontal");
  await dialog.getByRole("tab", { name: "MCP·API", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "조회·수정 토큰 발급", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "조회 전용 토큰 발급", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("tab", { name: "보안", exact: true }).click();
  await dialog
    .getByRole("button", { name: "비밀번호 변경", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    dialog.getByRole("button", { name: "비밀번호 변경", exact: true }),
  ).toBeInViewport();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: ".data/ux-review/profile-settings-mobile.png",
  });
});
