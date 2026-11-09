import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
test.skip(
  !process.env.PLANNING_E2E,
  "Use npm run test:e2e:planning for isolated authenticated fixtures",
);
const fixture = () =>
  JSON.parse(
    readFileSync(
      resolve(process.env.PLANNING_E2E_DIR!, "fixture.json"),
      "utf8",
    ),
  ) as { pmId: string; devId: string };
test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({ contentType: "text/css", body: "" }),
  );
});
async function visit(page: Page, tab: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page
    .getByLabel("프로젝트 필터", { exact: true })
    .selectOption("browser-project");
  await page.getByRole("button", { name: tab, exact: true }).click();
}

test("태스크의 담당 계정·시작일·공수·포인트를 편집한다", async ({
  page,
  request,
}) => {
  await visit(page, "태스크 보드");
  await page
    .getByRole("button", { name: "리소스 산정 작업", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "태스크 관리", exact: true });
  await dialog
    .getByRole("button", { name: "태스크 수정", exact: true })
    .click();
  await expect(dialog.getByLabel("담당자", { exact: true })).toHaveValue(
    fixture().devId,
  );
  await dialog.getByLabel("시작일", { exact: true }).fill("2026-11-09");
  await dialog.getByLabel("예상 공수 (시간)", { exact: true }).fill("20");
  await dialog.getByLabel("스토리 포인트", { exact: true }).fill("5");
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const data = await (await request.get("/api/dashboard")).json(),
    task = data.tasks.find(
      (t: { data: { id: string } }) => t.data.id === "browser-dev-task",
    ).data;
  expect(task.assigneeUserId).toBe(fixture().devId);
  expect(task.startDate).toBe("2026-11-09");
  expect(task.estimatedHours).toBe(20);
  expect(task.storyPoints).toBe(5);
});

test("이름 매칭과 리소스 과부하·휴무 예외를 관리하고 모바일에서 표를 스크롤한다", async ({
  page,
  request,
}) => {
  const before = await (
      await request.get(
        "/api/planning/resources?project=browser-project&from=2026-11-09&to=2026-11-10",
      )
    ).json(),
    dev = before.people.items.find(
      (p: { person: { id: string } }) => p.person.id === fixture().devId,
    );
  const reset = await request.post("/api/planning/capacity", {
    data: {
      userId: fixture().devId,
      hoursPerDay: 8,
      weekdays: [1, 2, 3, 4, 5],
      exceptions: {},
      revision: dev.capacityRevision,
    },
  });
  expect(reset.ok()).toBeTruthy();
  await visit(page, "담당자 매칭");
  await page.getByLabel("기존 담당자 이름", { exact: true }).fill(`Asana 이름`);
  await page
    .getByLabel("연결할 계정", { exact: true })
    .selectOption(fixture().devId);
  await page.getByRole("button", { name: "매칭 저장", exact: true }).click();
  await expect(
    page
      .getByRole("row")
      .filter({ has: page.getByText("Asana 이름", { exact: true }) }),
  ).toContainText("개발자 한명");
  const updated = await (await request.get("/api/dashboard")).json();
  expect(updated.assigneeMatches["browser-legacy-task"]).toBe(fixture().devId);
  await page.getByRole("button", { name: "리소스 계획", exact: true }).click();
  await page.getByLabel("리소스 조회 시작", { exact: true }).fill("2026-11-09");
  await page.getByLabel("리소스 조회 종료", { exact: true }).fill("2026-11-10");
  const row = page
    .getByRole("row")
    .filter({ has: page.getByText("개발자 한명", { exact: true }) });
  await expect(row).toContainText("10 / 8");
  await row
    .getByRole("button", { name: "가용 시간 설정", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "담당자 가용 시간",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "＋ 예외 날짜 추가", exact: true })
    .click();
  await dialog.getByLabel("예외 1 날짜", { exact: true }).fill("2026-11-10");
  await dialog.getByLabel("예외 1 가용 시간", { exact: true }).fill("0");
  await dialog
    .getByRole("button", { name: "가용 시간 저장", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(row).toContainText("20 / 8");
  await expect(row).toContainText("0 / 0");
  await page.setViewportSize({ width: 390, height: 844 });
  const scroll = page.getByRole("region", {
    name: "담당자별 예정 공수 표",
    exact: true,
  });
  await scroll.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: resolve(process.env.PLANNING_E2E_DIR!, "resource-mobile.png"),
    fullPage: true,
  });
});

test("공유한 내 작업 보기는 사용자별로 적용되고 개인 보기와 삭제 권한을 지킨다", async ({
  page,
  browser,
  request,
}) => {
  const name = `공유 내 작업 ${Date.now()}`;
  await visit(page, "태스크 보드");
  const controls = page.locator(".saved-views-bar");
  await controls.getByRole("button", { name: "내 작업", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "PM 일정 작업", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "리소스 산정 작업", exact: true }),
  ).not.toBeVisible();
  await controls
    .getByRole("button", { name: "현재 조건 저장", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "현재 필터 저장",
    exact: true,
  });
  await dialog.getByLabel("보기 이름", { exact: true }).fill(name);
  await dialog
    .getByRole("checkbox", { name: "워크스페이스 구성원과 공유", exact: true })
    .check();
  await dialog.getByRole("button", { name: "보기 저장", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3105",
    storageState: resolve(process.env.PLANNING_E2E_DIR!, "dev-storage.json"),
  });
  try {
    const other = await context.newPage();
    await other.route("https://fonts.googleapis.com/**", (route) =>
      route.fulfill({ contentType: "text/css", body: "" }),
    );
    await visit(other, "태스크 보드");
    await other
      .getByLabel("저장한 보기", { exact: true })
      .selectOption({ label: `${name} · 공유` });
    await expect(
      other.getByRole("button", { name: "리소스 산정 작업", exact: true }),
    ).toBeVisible();
    await expect(
      other.getByRole("button", { name: "PM 일정 작업", exact: true }),
    ).not.toBeVisible();
    await expect(
      other
        .locator(".saved-views-bar")
        .getByRole("button", { name: "보기 삭제", exact: true }),
    ).toBeDisabled();
    const saved = await context.request.post("/api/planning/views", {
      data: {
        id: `private-browser-${Date.now()}`,
        name: "개발자 개인 보기",
        visibility: "private",
        filters: { assigneeUserId: "me" },
        revision: 0,
      },
    });
    expect(saved.ok()).toBeTruthy();
    const views = await (await request.get("/api/planning/views")).json();
    expect(
      views.some(
        (v: { data: { name: string } }) => v.data.name === "개발자 개인 보기",
      ),
    ).toBeFalsy();
  } finally {
    await context.close();
  }
  await controls
    .getByRole("button", { name: "보기 삭제", exact: true })
    .click();
  const remove = page.getByRole("dialog", {
    name: "저장한 보기 삭제",
    exact: true,
  });
  await remove
    .getByRole("button", { name: "보기 삭제 확인", exact: true })
    .click();
  await expect(remove).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "PM 일정 작업", exact: true }),
  ).toBeVisible();
});

test("백로그 순서 변경과 스프린트 생성·배정·시작·종료·미완료 이동을 수행한다", async ({
  page,
  request,
}) => {
  await visit(page, "백로그·스프린트");
  const before = await (
      await request.get(
        "/api/planning/backlog?project=browser-project&limit=100",
      )
    ).json(),
    rows = page.locator(".planning-backlog-table tbody tr");
  await expect(rows).toHaveCount(before.total);
  if (before.total > 1) {
    await rows.last().dragTo(rows.first());
    const moved = await expect
      .poll(async () => {
        const response = await (
          await request.get(
            "/api/planning/backlog?project=browser-project&limit=100",
          )
        ).json();
        return response.items[0].data.id;
      })
      .toBe(before.items.at(-1).data.id);
  }
  const name = `릴리스 계획 ${Date.now()}`;
  await page
    .getByRole("button", { name: "＋ 스프린트 만들기", exact: true })
    .click();
  const create = page.getByRole("dialog", {
    name: "스프린트 만들기",
    exact: true,
  });
  await create.getByLabel("스프린트 이름", { exact: true }).fill(name);
  await create.getByLabel("목표", { exact: true }).fill("가입 기능 검증");
  await create
    .getByRole("button", { name: "스프린트 저장", exact: true })
    .click();
  await expect(create).not.toBeVisible();
  const sprints = await (
      await request.get("/api/planning/sprints?project=browser-project")
    ).json(),
    sprint = sprints.find(
      (s: { data: { name: string } }) => s.data.name === name,
    );
  await page
    .getByRole("checkbox", { name: "리소스 산정 작업 선택", exact: true })
    .check();
  await page
    .getByLabel("선택 태스크 이동 대상", { exact: true })
    .selectOption(sprint.data.id);
  await page
    .getByRole("button", { name: "선택 태스크 이동", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "리소스 산정 작업 선택", exact: true }),
  ).not.toBeVisible();
  await page
    .locator(".planning-sprint-list")
    .getByRole("button", { name: new RegExp(name) })
    .click();
  await expect(
    page.getByRole("button", { name: "리소스 산정 작업", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "스프린트 시작", exact: true })
    .click();
  const start = page.getByRole("dialog", {
    name: "스프린트 시작 확인",
    exact: true,
  });
  await start.getByRole("button", { name: "시작 확인", exact: true }).click();
  await expect(start).not.toBeVisible();
  await page
    .getByRole("button", { name: "스프린트 종료", exact: true })
    .click();
  const close = page.getByRole("dialog", {
    name: "스프린트 종료 확인",
    exact: true,
  });
  await close.getByRole("button", { name: "종료 확인", exact: true }).click();
  await expect(close).not.toBeVisible();
  await expect(page.getByText(/종료 시점 · 완료 0개/)).toBeVisible();
  await page
    .locator(".planning-sprint-list")
    .getByRole("button", { name: "프로젝트 백로그", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "리소스 산정 작업", exact: true }),
  ).toBeVisible();
  const snapshot = await (await request.get("/api/dashboard")).json();
  expect(
    snapshot.tasks.find(
      (t: { data: { id: string } }) => t.data.id === "browser-dev-task",
    ).data.sprintId,
  ).toBeNull();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: resolve(process.env.PLANNING_E2E_DIR!, "backlog-mobile.png"),
    fullPage: true,
  });
});

test("브라우저 GitHub OAuth로 기존 계정을 연결하며 콜백 쿠키와 세션을 확인한다", async ({
  page,
  request,
}) => {
  test.skip(
    !process.env.PLANNING_HTTP_SIMULATION,
    "Postman HTTP simulation required",
  );
  await page.route(
    (url) => url.pathname === "/api/auth/github/start",
    async (route) => {
      const started = await route.fetch({ maxRedirects: 0 });
      expect(started.status()).toBe(302);
      const url = new URL(started.headers().location!),
        code = `browser-code-${Date.now()}`,
        reply = await fetch("https://api.github.com/__mock/authorize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            challenge: url.searchParams.get("code_challenge"),
            id: 777,
            login: "oauth-browser-user",
            membership: "active",
          }),
        });
      expect(reply.status).toBe(200);
      await route.fulfill({
        response: started,
        status: 302,
        headers: {
          ...started.headers(),
          Location: `http://127.0.0.1:3105/api/auth/github/callback?code=${code}&state=${url.searchParams.get("state")}`,
        },
        body: "",
      });
    },
  );
  await visit(page, "프로젝트 현황");
  await page
    .getByRole("button", { name: "개인 프로필 및 토큰 설정", exact: true })
    .click();
  const profile = page.getByRole("dialog", {
    name: "프로필 및 토큰 설정",
    exact: true,
  });
  await profile
    .getByRole("link", { name: "내 GitHub 계정 연결", exact: true })
    .click();
  await expect(page).toHaveURL("http://127.0.0.1:3105/");
  const me = await (await page.request.get("/api/auth/me")).json();
  expect(me.user.id).toBe(fixture().pmId);
  expect(me.user.githubId).toBe("777");
  expect(me.user.githubOAuthConnected).toBeTruthy();
  expect(me.user.authProvider).toBe("password");
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === "pm_session")?.httpOnly).toBeTruthy();
  expect(cookies.some((c) => c.name === "pm_github_oauth")).toBeFalsy();
});

test("GitHub 활동에서 원본 담당자를 바꾸고 연결된 태스크에도 명시적으로 반영한다", async ({
  page,
  request,
}) => {
  test.skip(
    !process.env.PLANNING_HTTP_SIMULATION,
    "Postman HTTP simulation required",
  );
  await visit(page, "GitHub 활동");
  await page.getByRole("button", { name: /Synthetic task/ }).click();
  const dialog = page.getByRole("dialog", {
    name: "PR 및 파일 변경",
    exact: true,
  });
  await dialog.getByText("GitHub 이슈 담당자 변경", { exact: true }).click();
  await dialog.getByRole("button", { name: "모두 해제", exact: true }).click();
  await dialog
    .getByRole("checkbox", { name: "@next-dev", exact: true })
    .check();
  await dialog
    .getByLabel("내부 태스크 담당자도 변경", { exact: true })
    .selectOption("browser-dev-task");
  await dialog
    .getByRole("button", { name: "GitHub 담당자 저장", exact: true })
    .evaluate((element) => {
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
    });
  await expect(dialog.getByRole("status")).toContainText(
    "담당자를 변경했습니다.",
  );
  const snapshot = await (await request.get("/api/dashboard")).json();
  expect(
    snapshot.tasks.find(
      (t: { data: { id: string } }) => t.data.id === "browser-dev-task",
    ).data.assignee,
  ).toBe("next-dev");
  expect(
    snapshot.items.find(
      (i: { data: { id: string } }) => i.data.id === "org/repo#17",
    ).data.assignees,
  ).toEqual(["next-dev"]);
});
