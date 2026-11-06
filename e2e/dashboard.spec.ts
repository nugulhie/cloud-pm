import { test, expect } from "@playwright/test";
test("PM 현황, 태스크 수정, PR 파일 변경 및 모바일 화면", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByText(
      "데모 워크스페이스 · 아래 작업자·PR·완료 상태는 예시 데이터입니다.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "태스크 진행 현황" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "태스크 보드", exact: true }).click();
  await page.getByRole("button", { name: "보드 보기", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "태스크 보드", exact: true }),
  ).toBeVisible();
  await page
    .locator('.task-card[data-task-id="TASK-103"] .task-card-open')
    .click();
  const dialog = page.getByRole("dialog", { name: "태스크 관리" });
  await dialog
    .getByRole("button", { name: "태스크 수정", exact: true })
    .click();
  await dialog
    .getByLabel("담당자", { exact: true })
    .selectOption("demo-developer");
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.locator(".task-card").getByText("demo-developer", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "GitHub 활동", exact: true }).click();
  await page
    .getByRole("button")
    .filter({ has: page.getByText("소셜 로그인 화면 연결", { exact: true }) })
    .click();
  await expect(
    page.getByRole("dialog", { name: "PR 및 파일 변경" }),
  ).toBeVisible();
  await page.getByText("src/auth/LoginButton.tsx", { exact: true }).click();
  await expect(
    page
      .locator(".diff-added")
      .getByText("export function Login()", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "GitHub 활동", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/dashboard-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("HTTP MCP가 initialize와 도구 조회를 처리한다", async ({ request }) => {
  const headers = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  const initial = await request.post("/api/mcp", {
    headers,
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "integration-test", version: "1" },
      },
    },
  });
  expect(initial.ok()).toBeTruthy();
  expect((await initial.json()).result.serverInfo.name).toBe("cloud-pm-agent");
  const tools = await request.post("/api/mcp", {
    headers: { ...headers, "MCP-Protocol-Version": "2025-03-26" },
    data: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  });
  expect(tools.ok()).toBeTruthy();
  expect(
    (await tools.json()).result.tools.map((t: { name: string }) => t.name),
  ).toContain("list_tasks");
  const tasks = await request.post("/api/mcp", {
    headers: { ...headers, "MCP-Protocol-Version": "2025-03-26" },
    data: {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_tasks", arguments: {} },
    },
  });
  expect(tasks.ok()).toBeTruthy();
  expect(JSON.stringify(await tasks.json())).toContain("TASK-101");
});

test("작업 큐 화면과 데모 웹훅 차단", async ({ page, request }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "태스크 진행 현황" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "작업 큐", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "웹훅 동기화 작업" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "수신한 웹훅 작업이 없습니다. 웹훅 등록 후 작업자를 실행하세요.",
    ),
  ).toBeVisible();
  const response = await request.post("/api/webhooks/github", {
    data: { repository: { full_name: "demo/backend" } },
  });
  expect(response.status()).toBe(403);
});

test("저장소를 검색·선택하여 프로젝트를 만들고 변경 이력에서 확인한다", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "태스크 진행 현황" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "프로젝트 만들기", exact: true })
    .click();
  const form = page.getByRole("dialog", { name: "프로젝트 등록" });
  const name = `플랫폼 개편 ${Date.now()}`;
  await form.getByLabel("프로젝트 이름", { exact: true }).fill(name);
  await form
    .getByLabel("프로젝트 목표", { exact: true })
    .fill("가입 경험 개선");
  await form.getByLabel("저장소 검색", { exact: true }).fill("frontend");
  await form
    .getByRole("checkbox", { name: "demo/frontend", exact: true })
    .check();
  await form
    .getByRole("button", { name: "프로젝트 생성", exact: true })
    .click();
  await expect(form).not.toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "프로젝트 필터" }),
  ).toHaveValue(/project-/);
  await expect(
    page.locator(".projects").getByText(name, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "변경 이력", exact: true }).click();
  await page
    .getByRole("combobox", { name: "변경 종류" })
    .selectOption("project");
  await expect(
    page.locator(".history-event").getByRole("heading", { name, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".history-event pre")).toHaveCount(0);
});

test("PR·이슈 본문을 Markdown으로 렌더링하고 원문으로 전환한다", async ({
  page,
}) => {
  const details = new Map<string, unknown>();
  const body =
    "# 변경 목적\n\n|항목|상태|\n|---|---|\n|인증|완료|\n\n- [x] 구현 완료\n\n```ts\nconst ready = true;\n```\n\n<script>window.markdownInjected=true</script>";
  await page.route("**/api/dashboard", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.items[0].data.body = body;
    data.items[0].data.title = "Markdown PR 테스트";
    data.items[0].data.state = "open";
    data.items.push({
      revision: 1,
      updatedAt: new Date().toISOString(),
      data: {
        ...data.items[0].data,
        id: "demo/frontend#9999",
        number: 9999,
        title: "Markdown 이슈 테스트",
        kind: "issue",
        body: "## 이슈 설명\n\n**중요 내용**",
        files: [],
      },
    });
    for (const row of data.items) details.set(row.data.id, row.data);
    await route.fulfill({ response, json: data });
  });
  await page.route("**/api/github/item?**", (route) =>
    route.fulfill({
      json: details.get(new URL(route.request().url()).searchParams.get("id")!),
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "태스크 진행 현황" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "GitHub 활동", exact: true }).click();
  await page
    .locator(".activity-row")
    .filter({ hasText: "Markdown PR 테스트" })
    .click();
  const dialog = page.getByRole("dialog", { name: "PR 및 파일 변경" });
  await expect(
    dialog.getByRole("heading", { name: "변경 목적", exact: true }),
  ).toBeVisible();
  await expect(dialog.locator("table")).toHaveCount(1);
  await expect(
    dialog.locator(".markdown-body input[type=checkbox]"),
  ).toBeChecked();
  await expect(dialog.locator(".markdown-body pre")).toContainText(
    "const ready",
  );
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { markdownInjected?: boolean }).markdownInjected,
    ),
  ).toBeUndefined();
  await dialog.getByRole("tab", { name: "Markdown 원문", exact: true }).click();
  await expect(dialog.locator(".markdown-source")).toContainText("# 변경 목적");
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await page
    .locator(".activity-row")
    .filter({ hasText: "Markdown 이슈 테스트" })
    .click();
  await expect(
    page.getByRole("heading", { name: "이슈 설명", exact: true }),
  ).toBeVisible();
});

test("사용자 프로필에서 GitHub 토큰을 저장하고 개인 MCP 토큰을 발급한다", async ({
  page,
}) => {
  let profile: null | {
    id: string;
    login: string;
    displayName: string;
    role: string;
    githubTokenLast4: string;
    serviceTokenLast4: string | null;
    serviceTokenRole: string;
    repositoryCount: number;
    permissionsAt: string;
  } = null;
  await page.route("**/api/auth/**", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1);
    const body =
      route.request().method() === "POST" ? route.request().postDataJSON() : {};
    if (action === "workspace") {
      await route.fulfill({
        json: { organization: "demo", admin: false, members: [], invites: [] },
      });
      return;
    }
    if (action === "register") {
      profile = {
        id: "test-user",
        login: "test-user",
        displayName: body.displayName,
        role: "member",
        githubTokenLast4: "1234",
        serviceTokenLast4: null,
        serviceTokenRole: "read",
        repositoryCount: 3,
        permissionsAt: new Date().toISOString(),
      };
      await route.fulfill({ json: { user: profile } });
      return;
    }
    if (action === "profile" && profile) {
      profile = {
        ...profile,
        displayName: body.displayName,
        githubTokenLast4: body.githubToken.slice(-4),
      };
      await route.fulfill({ json: { user: profile } });
      return;
    }
    if (action === "service-token" && profile) {
      profile = {
        ...profile,
        serviceTokenLast4: "5678",
        serviceTokenRole: body.role,
      };
      await route.fulfill({
        json: { token: "cpm_test_once_5678", role: body.role },
      });
      return;
    }
    await route.fulfill({ json: { user: profile } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "개인 프로필 및 토큰 설정" }).click();
  const panel = page.locator(".account-panel");
  await panel.getByRole("button", { name: "계정 등록", exact: true }).click();
  await panel.getByLabel("표시 이름", { exact: true }).fill("테스트 사용자");
  await panel.getByLabel("서비스 아이디", { exact: true }).fill("test-user");
  await panel
    .getByLabel("비밀번호", { exact: true })
    .fill("long-test-password");
  await panel.getByRole("button", { name: "계정 만들기", exact: true }).click();
  await expect(panel.getByText("@test-user", { exact: true })).toBeVisible();
  await panel.getByRole("tab", { name: "GitHub 연결", exact: true }).click();
  await panel
    .getByLabel("개인 GitHub 연결 (선택)", { exact: true })
    .fill("fake_replacement_7890");
  await panel
    .getByRole("button", { name: "GitHub 연결 저장", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("저장했습니다");
  await panel.getByRole("tab", { name: "MCP·API", exact: true }).click();
  await panel
    .getByRole("button", { name: "조회 전용 토큰 발급", exact: true })
    .click();
  await expect(panel.getByLabel("새 서비스 토큰", { exact: true })).toHaveValue(
    "cpm_test_once_5678",
  );
});

test("인증이 만료되면 기존 워크스페이스 데이터를 화면에서 제거한다", async ({
  page,
}) => {
  let denied = false;
  await page.route("**/api/dashboard", async (route) => {
    if (denied) {
      await route.fulfill({
        status: 401,
        json: { error: "로그인이 필요합니다." },
      });
      return;
    }
    await route.continue();
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "태스크 진행 현황" }),
  ).toBeVisible();
  denied = true;
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "태스크 진행 현황" }),
  ).not.toBeVisible();
  await expect(
    page.getByText("사용자 계정으로 로그인해 워크스페이스를 확인하세요.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("일정 캘린더, 기능 등록, GitHub 선택 추가와 일괄 수정·삭제", async ({
  page,
  request,
}) => {
  const id = `manage-${Date.now()}`,
    name = `일정 테스트 ${id}`;
  const now = new Date(),
    startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`,
    endDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-03`;
  const created = await request.post("/api/projects", {
    data: {
      data: {
        id,
        name,
        goal: "# 목표\n\n**진행 상황**",
        repositories: ["demo/frontend"],
        startDate,
        endDate,
      },
    },
  });
  expect(created.ok()).toBeTruthy();
  await page.goto("/");
  await page.getByRole("button", { name: "캘린더", exact: true }).click();
  await expect(
    page.locator(".calendar-day button").filter({ hasText: name }),
  ).toHaveCount(3);
  await page.getByRole("button", { name: "항목 관리", exact: true }).click();
  await page.getByLabel("관리 종류").selectOption("task");
  await page
    .getByRole("button", { name: "＋ 태스크 추가", exact: true })
    .last()
    .click();
  const form = page.getByRole("dialog", { name: "태스크 관리" });
  await form.getByLabel("제목", { exact: true }).fill(`기능 ${id}`);
  await form
    .getByRole("combobox", { name: "프로젝트", exact: true })
    .selectOption(id);
  await expect(form.locator('select[name="feature"]')).toHaveCount(0);
  await form.getByRole("button", { name: "저장", exact: true }).click();
  await expect(form).not.toBeVisible();
  const dashboard = await (await request.get("/api/dashboard")).json();
  expect(
    dashboard.tasks.some(
      (row: { data: { title: string } }) => row.data.title === `기능 ${id}`,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "GitHub 활동", exact: true }).click();
  await page.getByLabel("선택: 소셜 로그인 화면 연결", { exact: true }).check();
  await page.getByLabel("가져올 프로젝트").selectOption(id);
  await page
    .getByRole("button", { name: "선택 항목 프로젝트에 추가", exact: true })
    .click();
  await expect(page.locator(".import-toolbar")).toContainText("1개 추가");
  const placement = page
    .locator(".selectable-activity")
    .filter({ hasText: "소셜 로그인 화면 연결" })
    .locator(".activity-destinations");
  await expect(placement).toContainText(name);
  await expect(placement).toContainText("소셜 로그인 화면 연결");
  await page.getByRole("button", { name: "항목 관리", exact: true }).click();
  await page.getByLabel("관리 종류").selectOption("task");
  const row = page
    .locator(".management-row")
    .filter({ hasText: "소셜 로그인 화면 연결" })
    .last();
  await row.getByRole("checkbox").check();
  const bulk = page
    .locator("details.management-form")
    .filter({ hasText: "선택 항목 일괄 수정" });
  await bulk.locator("summary").click();
  await bulk.getByLabel("변경 필드").selectOption("assignee");
  await bulk.getByLabel("새 담당자").selectOption("test-manager");
  await bulk
    .getByRole("button", { name: "선택 1개 수정", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("저장했습니다.");
  const updated = await (await request.get("/api/dashboard")).json();
  expect(
    updated.tasks.some(
      (t: { data: { project: string; assignee: string } }) =>
        t.data.project === id && t.data.assignee === "test-manager",
    ),
  ).toBeTruthy();
  await page.getByLabel("관리 종류").selectOption("project");
  const projectRow = page.locator(".management-row").filter({ hasText: name });
  await projectRow.getByRole("checkbox").check();
  await page.getByRole("button", { name: "선택 삭제", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "삭제 확인", exact: true })
    .click();
  await expect(projectRow).toHaveCount(0);
  await page.getByRole("button", { name: "변경 이력", exact: true }).click();
  await expect(
    page.locator(".history-event").filter({ hasText: name }).first(),
  ).toContainText("삭제");
});

test("전체 메뉴가 데스크톱·태블릿·모바일에서 화면 너비 안에 정렬된다", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".filters")).toBeVisible();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const tab of [
      "프로젝트 현황",
      "태스크 보드",
      "GitHub 활동",
      "변경 이력",
      "작업 큐",
      "항목 관리",
      "캘린더",
    ]) {
      if (width <= 720)
        await page
          .getByRole("button", { name: "메뉴 열기", exact: true })
          .click();
      await page.getByRole("button", { name: tab, exact: true }).click();
      await expect(
        page.getByRole("heading", { name: tab, exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${width}px ${tab} 가로 넘침`,
      ).toBeTruthy();
    }
  }
  await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
  await page.getByRole("button", { name: "항목 관리", exact: true }).click();
  const label = page.locator(".management-row label").first();
  const checkbox = await label.getByRole("checkbox").boundingBox();
  const bounds = await label.boundingBox();
  expect(checkbox).toBeTruthy();
  expect(bounds).toBeTruthy();
  expect(
    Math.abs(
      checkbox!.y + checkbox!.height / 2 - (bounds!.y + bounds!.height / 2),
    ),
  ).toBeLessThan(3);
  await page.screenshot({
    path: "test-results/management-mobile-aligned.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
  await page.getByRole("button", { name: "캘린더", exact: true }).click();
  const calendar = page.getByRole("region", { name: "월간 일정 캘린더" });
  expect(
    await calendar.evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBeTruthy();
});

test("태스크를 드래그·선택해 직접 완료하고 완료 작업도 다시 진행 상태로 바꾼다", async ({
  page,
  request,
}) => {
  const id = `drag-${Date.now()}`;
  const create = await request.post("/api/tasks", {
    data: {
      data: {
        id,
        project: "customer-platform",
        feature: "social-login",
        title: `드래그 테스트 ${id}`,
        status: "backlog",
      },
    },
  });
  expect(create.ok()).toBeTruthy();
  await page.goto("/");
  await page.getByRole("button", { name: "태스크 보드", exact: true }).click();
  await page.getByRole("button", { name: "보드 보기", exact: true }).click();
  // 반복 실행에서 쌓인 카드 위치에 의존하지 않고 대상 작업을 드래그한다.
  await page
    .getByRole("textbox", { name: "태스크 검색", exact: true })
    .fill(id);
  const card = page.locator(".task-card").filter({ hasText: id });
  await card
    .locator(".task-card-open")
    .dragTo(page.locator('.board-column[data-status="in_progress"]'));
  await expect(
    page
      .locator('.board-column[data-status="in_progress"]')
      .locator(".task-card")
      .filter({ hasText: id }),
  ).toBeVisible();
  const dashboard = await (await request.get("/api/dashboard")).json();
  expect(
    dashboard.tasks.find((t: { data: { id: string } }) => t.data.id === id).data
      .status,
  ).toBe("in_progress");
  await card
    .locator(".task-card-open")
    .dragTo(page.locator('.board-column[data-status="done"]'));
  await expect(
    page
      .locator('.board-column[data-status="done"]')
      .locator(".task-card")
      .filter({ hasText: id }),
  ).toBeVisible();
  const completed = await (await request.get("/api/dashboard")).json();
  expect(
    completed.tasks.find((t: { data: { id: string } }) => t.data.id === id).data
      .status,
  ).toBe("done");
  await card
    .locator(".task-card-open")
    .dragTo(page.locator('.board-column[data-status="in_progress"]'));
  await expect(
    page
      .locator('.board-column[data-status="in_progress"]')
      .locator(".task-card")
      .filter({ hasText: id }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await card.getByRole("combobox").selectOption("in_review");
  await expect(
    page
      .locator('.board-column[data-status="in_review"]')
      .locator(".task-card")
      .filter({ hasText: id }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
  await page.getByRole("button", { name: "태스크 보드", exact: true }).click();
  await page.getByRole("button", { name: "보드 보기", exact: true }).click();
  await page
    .getByRole("textbox", { name: "태스크 검색", exact: true })
    .fill(id);
  await expect(
    page
      .locator('.board-column[data-status="in_review"]')
      .locator(".task-card")
      .filter({ hasText: id }),
  ).toBeVisible();
  await page.getByRole("button", { name: "목록 보기", exact: true }).click();
  const taskRow = page.getByRole("row").filter({ hasText: id });
  await expect(taskRow).toBeVisible();
  await expect(taskRow.getByRole("combobox")).toHaveValue("in_review");
  await taskRow.getByRole("combobox").selectOption("ready");
  await expect(taskRow.getByRole("combobox")).toHaveValue("ready");
  await taskRow.getByRole("combobox").selectOption("done");
  await expect(taskRow.getByRole("combobox")).toHaveValue("done");
  await taskRow.getByRole("combobox").selectOption("ready");
  await page.getByRole("button", { name: "보드 보기", exact: true }).click();
  await expect(
    page
      .locator('.board-column[data-status="ready"]')
      .locator(".task-card")
      .filter({ hasText: id }),
  ).toBeVisible();
  await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
  await page.getByRole("button", { name: "개인 프로필 및 토큰 설정" }).click();
  await expect(
    page.getByRole("dialog", { name: "프로필 및 토큰 설정" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "닫기", exact: true })
    .click();
});

test("초대 링크로 접속하면 가입 설정이 열리고 주소에서 토큰을 지운다", async ({
  page,
}) => {
  await page.goto("/#invite=pminv_example_test_invitation");
  const dialog = page.getByRole("dialog", { name: "프로필 및 토큰 설정" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("워크스페이스 초대 링크로 접속했습니다.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "계정 만들기", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
});

test("개인 프로필에서 워크스페이스 초대 발급·취소와 가입 정책을 설정한다", async ({
  page,
}) => {
  const owner = {
    id: "owner",
    login: "owner",
    displayName: "소유자",
    role: "member",
    githubTokenLast4: "1234",
    serviceTokenLast4: null,
    serviceTokenRole: "read",
    repositoryCount: 3,
    permissionsAt: new Date().toISOString(),
  };
  let inviteOnly = false,
    invites: {
      id: string;
      expected_login: string;
      status: string;
      expires_at: string;
    }[] = [];
  await page.route("**/api/auth/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/auth/",
      "",
    );
    const body =
      route.request().method() === "POST" ? route.request().postDataJSON() : {};
    if (path === "me") {
      await route.fulfill({ json: { user: owner } });
      return;
    }
    if (path === "workspace") {
      if (route.request().method() === "POST") inviteOnly = body.inviteOnly;
      await route.fulfill({
        json: {
          organization: "demo",
          admin: true,
          inviteOnly,
          members: [
            {
              id: "owner",
              login: "owner",
              display_name: "소유자",
              owner: true,
            },
          ],
          invites,
        },
      });
      return;
    }
    if (path === "invites") {
      invites = [
        {
          id: "invite-1",
          expected_login: body.login,
          status: "pending",
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        },
      ];
      await route.fulfill({
        json: {
          id: "invite-1",
          url: "http://localhost/#invite=pminv_test_once",
        },
      });
      return;
    }
    if (path === "invites/revoke") {
      invites[0]!.status = "revoked";
      await route.fulfill({ json: { revoked: true } });
      return;
    }
    await route.fulfill({ json: {} });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "개인 프로필 및 토큰 설정" }).click();
  const dialog = page.getByRole("dialog", { name: "프로필 및 토큰 설정" });
  await dialog.getByRole("tab", { name: "워크스페이스", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "워크스페이스 멤버·초대" }),
  ).toBeVisible();
  await dialog
    .getByRole("checkbox", { name: "초대 링크로만 신규 가입 허용" })
    .check();
  await expect(
    dialog.getByRole("checkbox", { name: "초대 링크로만 신규 가입 허용" }),
  ).toBeChecked();
  await expect.poll(() => inviteOnly).toBeTruthy();
  await dialog.getByLabel("초대할 서비스 아이디 (선택)").fill("teammate");
  await dialog.getByRole("button", { name: "초대 링크 만들기" }).click();
  await expect(dialog.getByLabel("새 초대 링크")).toHaveValue(
    "http://localhost/#invite=pminv_test_once",
  );
  await expect(dialog.locator(".invite-list")).toContainText("@teammate");
  await dialog.getByRole("button", { name: "초대 취소", exact: true }).click();
  await expect(dialog.locator(".invite-list")).toContainText("취소");
});

test("삭제 확인은 한 번만 열리고 취소·연속 클릭·실패를 처리한다", async ({
  page,
  request,
}) => {
  const id = `confirm-${Date.now()}`,
    name = `삭제 확인 테스트 ${id}`;
  const created = await request.post("/api/projects", {
    data: { data: { id, name, goal: "", repositories: ["demo/frontend"] } },
  });
  expect(created.ok()).toBeTruthy();
  let nativeDialogs = 0,
    requests = 0,
    fail = false;
  page.on("dialog", async (dialog) => {
    nativeDialogs++;
    await dialog.dismiss();
  });
  await page.route("**/api/manage/delete", async (route) => {
    requests++;
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (fail)
      await route.fulfill({
        status: 409,
        json: { error: "다른 사용자가 변경했습니다." },
      });
    else await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "항목 관리", exact: true }).click();
  const row = page.locator(".management-row").filter({ hasText: name });
  await row
    .getByRole("button", { name: "삭제", exact: true })
    .evaluate((element) => {
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
    });
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toContainText(name);
  await page.waitForTimeout(350);
  await expect(dialog).toBeVisible();
  expect(requests).toBe(0);
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toBeVisible();
  expect(requests).toBe(0);
  fail = true;
  await row.getByRole("button", { name: "삭제", exact: true }).click();
  await dialog.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "다른 사용자가 변경했습니다.",
  );
  await expect(row).toBeAttached();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  fail = false;
  await row.getByRole("button", { name: "삭제", exact: true }).click();
  await dialog
    .getByRole("button", { name: "삭제 확인", exact: true })
    .evaluate((element) => {
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
    });
  await expect(dialog).toHaveCount(0);
  await expect(row).toHaveCount(0);
  expect(requests).toBe(2);
  expect(nativeDialogs).toBe(0);
});

test("워크스페이스를 생성·전환하고 기존 화면의 프로젝트 선택을 초기화한다", async ({
  page,
}) => {
  const workspaces = [
    {
      id: "main",
      name: "기본 워크스페이스",
      description: "기존 프로젝트",
      role: "owner",
      owner_id: "owner",
    },
  ];
  let currentId = "main";
  await page.route("**/api/auth/workspaces**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { currentId, workspaces } });
      return;
    }
    const body = route.request().postDataJSON();
    if (path.endsWith("/switch")) {
      currentId = body.id;
      await route.fulfill({ json: { id: currentId } });
      return;
    }
    const created = {
      id: `ws-${Date.now()}`,
      name: body.name,
      description: body.description,
      role: "owner",
      owner_id: "owner",
    };
    workspaces.push(created);
    await route.fulfill({ json: created });
  });
  await page.route("**/api/dashboard", async (route) => {
    const response = await route.fetch(),
      data = await response.json();
    data.viewer.userId = "owner";
    data.viewer.workspaceId = currentId;
    if (currentId !== "main") {
      for (const key of [
        "projects",
        "features",
        "tasks",
        "links",
        "attention",
        "syncs",
      ])
        data[key] = [];
    }
    await route.fulfill({ response, json: data });
  });
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "프로젝트 필터" })
    .selectOption("customer-platform");
  await page.getByRole("button", { name: "워크스페이스 선택 및 생성" }).click();
  const dialog = page.getByRole("dialog", {
    name: "워크스페이스 선택 및 생성",
  });
  await dialog
    .getByLabel("워크스페이스 이름", { exact: true })
    .fill("플랫폼 개발팀");
  await dialog
    .getByLabel("설명", { exact: true })
    .fill("백엔드와 프런트엔드 협업");
  await dialog
    .getByRole("button", { name: "워크스페이스 생성", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "워크스페이스 선택 및 생성" }),
  ).toContainText("플랫폼 개발팀");
  await expect(
    page.getByRole("combobox", { name: "프로젝트 필터" }),
  ).toHaveValue("");
  await expect(page.locator(".projects")).toBeEmpty();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
  await page.getByRole("button", { name: "워크스페이스 선택 및 생성" }).click();
  await dialog
    .getByRole("button")
    .filter({ hasText: "기본 워크스페이스" })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".projects")).toContainText("고객 플랫폼");
});

test("하위 태스크 생성과 작업 유형 저장·조회", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "태스크 보드", exact: true }).click();
  await page.getByRole("button", { name: "보드 보기", exact: true }).click();
  await page
    .locator('.task-card[data-task-id="TASK-103"] .task-card-open')
    .click();
  const dialog = page.getByRole("dialog", { name: "태스크 관리" });
  await dialog
    .getByRole("button", { name: "＋ 하위 태스크 추가", exact: true })
    .click();
  const title = `버그 하위 작업 ${Date.now()}`;
  await dialog.getByLabel("제목", { exact: true }).fill(title);
  await dialog.getByLabel("작업 유형", { exact: true }).selectOption("bug");
  await expect(dialog.getByLabel("상위 태스크", { exact: true })).toHaveValue(
    "TASK-103",
  );
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const card = page.locator(".task-card").filter({ hasText: title });
  await expect(card).toContainText("버그");
  await expect(card).toContainText("상위:");
  await page.reload();
  await page.getByRole("button", { name: "태스크 보드", exact: true }).click();
  await page.getByRole("button", { name: "보드 보기", exact: true }).click();
  await page.locator(".task-filter-menu > summary").click();
  await page.getByLabel("작업 유형 필터").selectOption("bug");
  await page.locator(".task-card-open").filter({ hasText: title }).click();
  await dialog
    .getByRole("button", { name: "태스크 수정", exact: true })
    .click();
  await expect(dialog.getByLabel("작업 유형", { exact: true })).toHaveValue(
    "bug",
  );
  await expect(dialog.getByLabel("상위 태스크", { exact: true })).toHaveValue(
    "TASK-103",
  );
});

test("태스크 댓글 Markdown 작성·수정·삭제", async ({ page, request }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "태스크 보드", exact: true }).click();
  await page.getByRole("button", { name: "보드 보기", exact: true }).click();
  await page
    .locator('.task-card[data-task-id="TASK-103"] .task-card-open')
    .click();
  const thread = page.getByRole("region", { name: "태스크 댓글" });
  const marker = `댓글-${Date.now()}`;
  await thread
    .getByRole("textbox", { name: "새 댓글", exact: true })
    .fill(`**${marker}** 검토 요청`);
  await thread.getByRole("button", { name: "댓글 등록", exact: true }).click();
  const comment = thread.locator(".comment-item").filter({ hasText: marker });
  await expect(
    comment.locator("strong").filter({ hasText: marker }),
  ).toBeVisible();
  await comment.getByRole("button", { name: "댓글 수정", exact: true }).click();
  await thread
    .getByRole("textbox", { name: "댓글 수정 내용", exact: true })
    .fill(`**${marker}** 수정 완료`);
  await thread
    .getByRole("button", { name: "댓글 수정 저장", exact: true })
    .click();
  await expect(comment).toContainText("수정 완료");
  await expect(comment).toContainText("수정됨");
  const result = await (
    await request.get("/api/comments?task=TASK-103")
  ).json();
  expect(
    result.comments.some(
      (c: { data: { body: string } }) =>
        c.data.body.includes("수정 완료") && c.data.body.includes(marker),
    ),
  ).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await comment.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/task-discussion-mobile.png" });
  await comment.getByRole("button", { name: "댓글 삭제", exact: true }).click();
  const confirmation = comment.getByRole("group", { name: "댓글 삭제 확인" });
  await confirmation.getByRole("button", { name: "취소", exact: true }).click();
  await expect(comment).toBeVisible();
  await comment.getByRole("button", { name: "댓글 삭제", exact: true }).click();
  await confirmation
    .getByRole("button", { name: "삭제 확인", exact: true })
    .click();
  await expect(comment).toHaveCount(0);
});

test("개인 알림함 읽음 실패·재시도와 태스크 이동", async ({ page }) => {
  let read = false,
    fail = true;
  const id = "11111111-1111-4111-8111-111111111111";
  await page.route("**/api/notifications", async (route) =>
    route.fulfill({
      json: {
        unread: read ? 0 : 1,
        notifications: [
          {
            id,
            revision: 1,
            task: "TASK-103",
            title: "멘션된 태스크",
            author: "reviewer",
            body: "확인 부탁드립니다.",
            updatedAt: new Date().toISOString(),
            read,
          },
        ],
      },
    }),
  );
  await page.route("**/api/notifications/read", async (route) => {
    if (fail) {
      await route.fulfill({
        status: 409,
        json: { error: "잠시 후 다시 시도하세요." },
      });
      return;
    }
    expect(route.request().postDataJSON()).toEqual({ id, revision: 1 });
    read = true;
    await route.fulfill({ json: { read: true } });
  });
  await page.goto("/");
  await page.setViewportSize({ width: 390, height: 844 });
  const trigger = page.getByRole("button", {
    name: "알림함, 미읽음 1개",
    exact: true,
  });
  await trigger.click();
  const inbox = page.getByRole("dialog", { name: "개인 알림함" });
  await inbox.getByRole("button").filter({ hasText: "멘션된 태스크" }).click();
  await expect(inbox.getByRole("alert")).toContainText("잠시 후 다시 시도");
  await expect(inbox).toBeVisible();
  fail = false;
  await inbox.getByRole("button").filter({ hasText: "멘션된 태스크" }).click();
  await expect(inbox).not.toBeVisible();
  await expect(page.getByRole("dialog", { name: "태스크 관리" })).toBeVisible();
  await expect(page.getByRole("region", { name: "태스크 댓글" })).toBeVisible();
  expect(read).toBeTruthy();
});

test("선행 작업 선택·검색·차단 표시와 관계 해제 후 삭제", async ({
  page,
  request,
}) => {
  const prefix = `dependency-${Date.now()}`;
  const prerequisiteId = `${prefix}-before`,
    dependentId = `${prefix}-after`;
  const create = async (id: string, title: string) => {
    const response = await request.post("/api/tasks", {
      data: {
        data: {
          id,
          title,
          project: "customer-platform",
          feature: "social-login",
        },
      },
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const prerequisite = await create(prerequisiteId, "API 선행 작업");
  await create(dependentId, `화면 후행 작업 ${prefix}`);
  await page.goto("/");
  await page.getByRole("button", { name: "태스크 보드", exact: true }).click();
  await page.getByRole("button", { name: "보드 보기", exact: true }).click();
  await page
    .getByRole("textbox", { name: "태스크 검색", exact: true })
    .fill(dependentId);
  const card = page.locator(`.task-card[data-task-id="${dependentId}"]`);
  await card.locator(".task-card-open").click();
  const dialog = page.getByRole("dialog", { name: "태스크 관리" });
  await dialog
    .getByRole("button", { name: "태스크 수정", exact: true })
    .click();
  await dialog
    .getByText("추가 설정 · 의존관계, 완료 조건", { exact: true })
    .click();
  const editor = dialog.getByRole("group", {
    name: "태스크 의존관계",
    exact: true,
  });
  await editor
    .getByRole("textbox", { name: "선행 작업 검색", exact: true })
    .fill(prerequisiteId);
  await editor
    .getByRole("checkbox", {
      name: `선행 작업 API 선행 작업 (${prerequisiteId})`,
      exact: true,
    })
    .check();
  // 검색에서 보이지 않는 선택도 저장되어야 한다.
  await editor
    .getByRole("textbox", { name: "선행 작업 검색", exact: true })
    .fill("아무 작업도 없음");
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(card.locator(".dependency-badge")).toContainText(
    "선행 대기 1개",
  );
  if (
    !(await page
      .locator(".task-filter-menu")
      .evaluate((element) => element.open))
  )
    await page.locator(".task-filter-menu > summary").click();
  await page
    .getByRole("checkbox", { name: "선행 대기만", exact: true })
    .click();
  await expect(card).toBeVisible();
  const dependencies = await (
    await request.get(`/api/tasks/dependencies?task=${dependentId}`)
  ).json();
  expect(dependencies.blocked).toBeTruthy();
  expect(dependencies.predecessors[0].id).toBe(prerequisiteId);
  const blockedDelete = await request.post("/api/manage/delete", {
    data: {
      kind: "task",
      entries: [{ id: prerequisiteId, revision: prerequisite.revision }],
    },
  });
  expect(blockedDelete.status()).toBe(400);
  await card.locator(".task-card-open").click();
  await dialog
    .getByRole("button", { name: "태스크 수정", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog
    .getByText("추가 설정 · 의존관계, 완료 조건", { exact: true })
    .click();
  await editor.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/task-dependencies-mobile.png" });
  await editor
    .getByRole("button", { name: "선행 작업 모두 해제", exact: true })
    .click();
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(card).toHaveCount(0);
  if (
    !(await page
      .locator(".task-filter-menu")
      .evaluate((element) => element.open))
  )
    await page.locator(".task-filter-menu > summary").click();
  await page
    .getByRole("checkbox", { name: "선행 대기만", exact: true })
    .click();
  await expect(card).toBeVisible();
  await expect(card.locator(".dependency-badge")).toHaveCount(0);
  const dashboard = await (await request.get("/api/dashboard")).json();
  const dependent = dashboard.tasks.find(
    (t: { data: { id: string } }) => t.data.id === dependentId,
  );
  expect(dependent.data.dependsOn).toEqual([]);
  const removed = await request.post("/api/manage/delete", {
    data: {
      kind: "task",
      entries: [
        { id: prerequisiteId, revision: prerequisite.revision },
        { id: dependentId, revision: dependent.revision },
      ],
    },
  });
  expect(removed.ok()).toBeTruthy();
});

test("조회 전용 사용자는 화면을 확인하고 수정 동작은 비활성화된다", async ({
  page,
}) => {
  await page.route("**/api/dashboard", async (route) => {
    const response = await route.fetch(),
      data = await response.json();
    data.viewer.role = "read";
    data.viewer.workspaceRole = "viewer";
    await route.fulfill({ response, json: data });
  });
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "reader",
          login: "reader",
          displayName: "읽기 사용자",
          githubTokenLast4: "1234",
          serviceTokenLast4: null,
          serviceTokenRole: "read",
          repositoryCount: 1,
        },
        effectiveRole: "read",
        workspaceRole: "viewer",
      },
    }),
  );
  await page.route("**/api/auth/workspace", (route) =>
    route.fulfill({
      json: {
        id: "main",
        name: "제품",
        organization: "demo",
        role: "viewer",
        admin: false,
        members: [],
        invites: [],
      },
    }),
  );
  await page.route("**/api/auth/workspaces", (route) =>
    route.fulfill({
      json: {
        currentId: "main",
        workspaces: [{ id: "main", name: "제품", role: "viewer" }],
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "프로젝트 만들기" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "태스크 추가" }).first(),
  ).toBeDisabled();
  await page.locator(".overview-tools > summary").click();
  await expect(
    page.getByRole("button", { name: "GitHub 수동 동기화" }),
  ).toBeDisabled();
  await page.getByLabel("프로젝트 필터").selectOption("customer-platform");
  await expect(
    page.getByRole("button", { name: "프로젝트 삭제", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator(".projects").getByRole("button", { name: /프로젝트 삭제/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "프로젝트 관리", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "태스크 보드", exact: true }).click();
  await page.getByRole("button", { name: "보드 보기", exact: true }).click();
  const card = page.locator('.task-card[data-task-id="TASK-103"]');
  await expect(card).toHaveAttribute("draggable", "false");
  await expect(card.getByRole("combobox")).toBeDisabled();
  await card.locator(".task-card-open").click();
  const task = page.getByRole("dialog", { name: "태스크 관리" });
  await expect(task.locator(".task-detail-title")).toContainText(
    "인증 환경 설정",
  );
  await expect(
    task.getByRole("button", { name: "태스크 수정", exact: true }),
  ).toHaveCount(0);
  await expect(task.getByRole("combobox")).toBeDisabled();
  await expect(
    task.getByRole("textbox", { name: "새 댓글", exact: true }),
  ).toHaveCount(0);
  await task.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "계층 보기", exact: true }).click();
  const tree = page.getByRole("region", { name: "태스크 계층 보기" });
  await expect(tree.getByRole("checkbox").first()).toBeDisabled();
  await expect(
    tree.getByRole("button", { name: /하위 태스크 추가/ }).first(),
  ).toBeDisabled();
  await page.getByRole("button", { name: "항목 관리", exact: true }).click();
  await expect(page.locator(".management-panel")).toContainText(
    "조회 전용 권한입니다",
  );
  await page.getByRole("button", { name: "개인 프로필 및 토큰 설정" }).click();
  const profile = page.getByRole("dialog", { name: "프로필 및 토큰 설정" });
  await profile.getByRole("tab", { name: "MCP·API", exact: true }).click();
  await expect(
    profile.getByRole("button", { name: "조회·수정 토큰 발급", exact: true }),
  ).toBeDisabled();
  await expect(
    profile.getByRole("button", { name: "조회 전용 토큰 발급", exact: true }),
  ).toBeEnabled();
});

test("소유자가 멤버 역할을 변경하고 조회 전용 초대·멤버 제외를 관리한다", async ({
  page,
}) => {
  const owner = {
    id: "owner",
    login: "owner",
    displayName: "소유자",
    githubTokenLast4: "1234",
    serviceTokenRole: "read",
    repositoryCount: 1,
  };
  const members = [
    {
      id: "owner",
      login: "owner",
      display_name: "소유자",
      role: "owner",
      owner: true,
    },
    {
      id: "member",
      login: "member",
      display_name: "팀원",
      role: "member",
      owner: false,
    },
  ];
  let roleUpdates = 0,
    removals = 0,
    inviteRole = "";
  await page.route("**/api/auth/**", async (route) => {
    const action = new URL(route.request().url()).pathname.replace(
      "/api/auth/",
      "",
    );
    const body =
      route.request().method() === "POST" ? route.request().postDataJSON() : {};
    if (action === "me")
      return route.fulfill({
        json: { user: owner, effectiveRole: "write", workspaceRole: "owner" },
      });
    if (action === "workspaces")
      return route.fulfill({
        json: {
          currentId: "main",
          workspaces: [{ id: "main", name: "제품", role: "owner" }],
        },
      });
    if (action === "workspace")
      return route.fulfill({
        json: {
          id: "main",
          name: "제품",
          viewerId: "owner",
          ownerId: "owner",
          organization: "demo",
          role: "owner",
          admin: true,
          inviteOnly: false,
          members,
          invites: [],
        },
      });
    if (action === "members/role") {
      expect(body).toEqual({
        userId: "member",
        expectedRole: "member",
        role: "viewer",
      });
      members[1]!.role = "viewer";
      roleUpdates++;
      return route.fulfill({ json: { role: "viewer" } });
    }
    if (action === "members/remove") {
      expect(body).toEqual({ userId: "member", expectedRole: "viewer" });
      members.splice(1, 1);
      removals++;
      return route.fulfill({ json: { removed: true } });
    }
    if (action === "invites") {
      inviteRole = body.role;
      return route.fulfill({
        json: {
          id: "invite",
          url: "http://localhost/#invite=pminv_readonly_invite",
        },
      });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "개인 프로필 및 토큰 설정" }).click();
  const dialog = page.getByRole("dialog", { name: "프로필 및 토큰 설정" });
  await dialog.getByRole("tab", { name: "워크스페이스", exact: true }).click();
  const row = dialog
    .locator(".workspace-member-row")
    .filter({ hasText: "@member" });
  await row
    .getByRole("combobox", { name: "@member 역할", exact: true })
    .selectOption("viewer");
  await row.getByRole("button", { name: "역할 저장", exact: true }).click();
  await expect(row.locator(".badge")).toHaveText("조회 전용");
  expect(roleUpdates).toBe(1);
  await expect(
    dialog.getByRole("combobox", { name: "@owner 역할", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("combobox", { name: "초대 역할", exact: true })
    .selectOption("viewer");
  await dialog
    .getByRole("button", { name: "초대 링크 만들기", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "새 초대 링크", exact: true }),
  ).toBeVisible();
  expect(inviteRole).toBe("viewer");
  await page.setViewportSize({ width: 390, height: 844 });
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "test-results/workspace-member-roles-mobile.png",
  });
  await row.getByRole("button", { name: "멤버 제외", exact: true }).click();
  const confirmation = row.getByRole("group", {
    name: "@member 제외 확인",
    exact: true,
  });
  await confirmation.getByRole("button", { name: "취소", exact: true }).click();
  expect(removals).toBe(0);
  await row.getByRole("button", { name: "멤버 제외", exact: true }).click();
  await confirmation
    .getByRole("button", { name: "제외 확인", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  expect(removals).toBe(1);
});

test("프로필 MCP 연결 점검의 인증 실패·재시도·권한·토큰 폐기", async ({
  page,
}) => {
  let last = false,
    issued = false;
  const rpcMethods: string[] = [];
  const profile = {
    id: "owner",
    login: "owner",
    displayName: "소유자",
    githubTokenLast4: "1234",
    serviceTokenLast4: "test",
    serviceTokenRole: "write",
    serviceTokenWorkspaceId: "main",
    repositoryCount: 1,
  };
  await page.route("**/api/auth/**", async (route) => {
    const action = new URL(route.request().url()).pathname.replace(
      "/api/auth/",
      "",
    );
    if (action === "me")
      return route.fulfill({
        json: { user: profile, effectiveRole: "write", workspaceRole: "owner" },
      });
    if (action === "mcp/status")
      return route.fulfill({
        json: {
          url: "http://127.0.0.1:3100/api/mcp",
          publicHttps: false,
          configured: true,
          workspace: { id: "main", name: "제품 공간" },
          effectiveRole: "write",
          workspaceRole: "owner",
          token: {
            exists: !!profile.serviceTokenLast4,
            currentWorkspace: true,
            role: "write",
          },
          lastConnection: last
            ? {
                at: new Date().toISOString(),
                client: "cloud-pm-connection-check",
                method: "tools/list",
                protocolVersion: "2025-11-25",
              }
            : null,
        },
      });
    if (action === "service-token") {
      issued = true;
      return route.fulfill({
        json: {
          token: "new-personal-check-token",
          role: "write",
          workspaceId: "main",
        },
      });
    }
    if (action === "revoke-service-token") {
      profile.serviceTokenLast4 = "";
      last = false;
      return route.fulfill({ json: { revoked: true } });
    }
    if (action === "workspaces")
      return route.fulfill({
        json: {
          currentId: "main",
          workspaces: [{ id: "main", name: "제품 공간", role: "owner" }],
        },
      });
    if (action === "workspace")
      return route.fulfill({
        json: {
          id: "main",
          name: "제품 공간",
          role: "owner",
          viewerId: "owner",
          admin: true,
          organization: "demo",
          members: [],
          invites: [],
        },
      });
    return route.fulfill({ json: {} });
  });
  await page.route("**/api/mcp", async (route) => {
    const request = route.request(),
      body = request.postDataJSON();
    rpcMethods.push(body.method);
    expect(request.headers()["x-workspace-id"]).toBe("main");
    if (request.headers().authorization !== "Bearer new-personal-check-token")
      return route.fulfill({ status: 401, json: { error: "인증 실패" } });
    if (body.method === "initialize")
      return route.fulfill({
        json: {
          jsonrpc: "2.0",
          id: 1,
          result: {
            protocolVersion: "2025-11-25",
            serverInfo: { name: "cloud-pm-agent", version: "1" },
            capabilities: {},
          },
        },
      });
    expect(body.method).toBe("tools/list");
    last = true;
    return route.fulfill({
      json: {
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [{ name: "list_tasks" }, { name: "create_task" }] },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "개인 프로필 및 토큰 설정" }).click();
  await page.getByRole("tab", { name: "MCP·API", exact: true }).click();
  const panel = page.getByRole("region", {
    name: "Claude MCP 연결",
    exact: true,
  });
  await expect(
    panel.getByRole("textbox", { name: "MCP 연결 주소", exact: true }),
  ).toHaveValue("http://127.0.0.1:3100/api/mcp");
  await expect(panel).toContainText("공개 HTTPS 주소가 필요");
  await panel
    .getByLabel("점검할 개인 MCP 토큰", { exact: true })
    .fill("invalid-token");
  await panel
    .getByRole("button", { name: "MCP 연결 점검", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText("연결 점검에 실패");
  await page
    .getByRole("button", { name: "조회·수정 토큰 발급", exact: true })
    .click();
  expect(issued).toBeTruthy();
  await expect(
    panel.getByLabel("점검할 개인 MCP 토큰", { exact: true }),
  ).toHaveValue("new-personal-check-token");
  await expect(
    panel.getByLabel("점검할 개인 MCP 토큰", { exact: true }),
  ).toHaveAttribute("type", "password");
  await panel
    .getByRole("button", { name: "MCP 연결 점검", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "2개 도구 · 조회·수정 지원",
  );
  await expect(panel).toContainText("cloud-pm-connection-check");
  expect(rpcMethods).toEqual(["initialize", "initialize", "tools/list"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/mcp-connection-mobile.png" });
  await page.getByRole("button", { name: "토큰 폐기", exact: true }).click();
  await expect(
    panel.getByLabel("점검할 개인 MCP 토큰", { exact: true }),
  ).toHaveValue("");
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("new-personal-check-token");
});
