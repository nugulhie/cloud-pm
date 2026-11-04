import { test, expect } from "@playwright/test";

for (const failed of [false, true]) {
  test(`GitHub App 설정은 PAT 입력 없이 ${failed ? "연결 오류" : "공유 상태"}를 표시한다`, async ({
    page,
  }) => {
    const owner = {
      id: "app-owner",
      login: "pm-owner",
      displayName: "기획자",
      role: "member",
      githubTokenLast4: "",
      githubConnected: false,
      serviceTokenLast4: null,
      serviceTokenRole: "read",
      repositoryCount: 0,
      permissionsAt: new Date().toISOString(),
    };
    await page.route("**/api/auth/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/me")
        return route.fulfill({ json: { user: owner } });
      if (path === "/api/auth/workspace")
        return route.fulfill({
          json: {
            id: "main",
            name: "PM 워크스페이스",
            organization: "org",
            admin: true,
            role: "owner",
            viewerId: owner.id,
            inviteOnly: false,
            members: [
              { ...owner, display_name: owner.displayName, owner: true },
            ],
            invites: [],
            githubConnection: {
              kind: "app",
              appId: "1234",
              login: "GitHub App #1234",
              last4: "",
              repositoryCount: failed ? 0 : 3,
              ...(failed
                ? { error: "GitHub App 설치·권한·개인 키 연결을 확인하세요." }
                : {}),
            },
          },
        });
      return route.fulfill({ json: {} });
    });
    await page.goto("/");
    await page
      .getByRole("button", { name: "개인 프로필 및 토큰 설정" })
      .click();
    await page.getByRole("tab", { name: "워크스페이스", exact: true }).click();
    const settings = page.locator(".workspace-github-settings");
    await expect(settings).toBeVisible();
    await expect(settings).toContainText("개인 PAT는 필요하지");
    await expect(settings).toContainText("설치 토큰은 서버에서 자동 갱신");
    await expect(
      settings.getByLabel("공용 GitHub 토큰", { exact: true }),
    ).toHaveCount(0);
    await expect(
      settings.getByRole("button", { name: "공용 연결 해제", exact: true }),
    ).toHaveCount(0);
    if (failed) {
      await expect(page.locator(".profile-summary")).toContainText(
        "조직 GitHub App 연결 확인 필요",
      );
      await expect(settings.getByRole("alert")).toHaveText(
        "GitHub App 설치·권한·개인 키 연결을 확인하세요.",
      );
      await expect(settings).toContainText("연결 확인 필요");
      await expect(settings).not.toContainText("공유 중");
    } else {
      await expect(page.locator(".profile-summary")).toContainText(
        "조직 GitHub App 연결 · 저장소 3개",
      );
      await expect(settings).toContainText(
        "GitHub App #1234 연결 · 저장소 3개 공유 중",
      );
      await expect(settings.getByRole("alert")).toHaveCount(0);
    }
  });
}
