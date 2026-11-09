import { test, expect, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";

test.skip(!process.env.PLANNING_E2E, "격리된 인증 fixture가 필요합니다.");
const fixture = () =>
  JSON.parse(
    readFileSync(
      resolve(process.env.PLANNING_E2E_DIR!, "fixture.json"),
      "utf8",
    ),
  ) as { pmId: string; devId: string };
async function post(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post(`/api/${path}`, { data });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}
test("초안은 새로고침 후 정책 연결까지 복원하고 저장 후 제거한다", async ({
  page,
  request,
  browser,
}) => {
  const policy = await post(request, "knowledge", {
    data: {
      id: "draft-policy",
      kind: "policy",
      name: "초안 테스트 정책",
      content: "정책 내용",
    },
  });
  await page.goto("/");
  await page
    .getByLabel("프로젝트 필터", { exact: true })
    .selectOption("browser-project");
  await page.getByRole("button", { name: "PRD 관리", exact: true }).click();
  await page.getByRole("button", { name: "＋ PRD 작성", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "PRD 작성", exact: true });
  await dialog
    .getByRole("textbox", { name: "기능명", exact: true })
    .fill("초안과 정책 복원");
  await dialog
    .getByLabel("상세설명", { exact: true })
    .fill("새로고침 이전의 설명");
  await dialog.getByRole("button", { name: "정책 선택", exact: true }).click();
  await dialog.getByRole("checkbox", { name: /초안 테스트 정책/ }).check();
  await expect(
    dialog.getByRole("button", {
      name: "초안 테스트 정책 연결 해제",
      exact: true,
    }),
  ).toBeVisible();
  page.on("dialog", (d) => void d.accept());
  await page.reload();
  await page.getByRole("button", { name: "PRD 관리", exact: true }).click();
  await page.getByRole("button", { name: "＋ PRD 작성", exact: true }).click();
  await dialog.getByRole("button", { name: "초안 복원", exact: true }).click();
  await expect(
    dialog.getByRole("textbox", { name: "기능명", exact: true }),
  ).toHaveValue("초안과 정책 복원");
  await expect(dialog.getByLabel("상세설명", { exact: true })).toHaveValue(
    "새로고침 이전의 설명",
  );
  await expect(
    dialog.getByRole("button", {
      name: "초안 테스트 정책 연결 해제",
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "PRD 저장", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const dashboard = await (await request.get("/api/dashboard")).json();
  expect(
    dashboard.requirements.find(
      (r: any) => r.data.featureName === "초안과 정책 복원",
    ).data.policyIds,
  ).toEqual([policy.data.id]);
  await page.getByRole("button", { name: "＋ PRD 작성", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "초안 복원", exact: true }),
  ).toHaveCount(0);
  // 같은 브라우저의 다른 계정은 PM의 초안을 표시하지 않는다.
  await dialog
    .getByRole("textbox", { name: "기능명", exact: true })
    .fill("PM 개인 초안");
  const cookies = JSON.parse(
    readFileSync(
      resolve(process.env.PLANNING_E2E_DIR!, "dev-storage.json"),
      "utf8",
    ),
  ).cookies;
  await page.context().clearCookies();
  await page.context().addCookies(cookies);
  await page.reload();
  await page.getByRole("button", { name: "PRD 관리", exact: true }).click();
  await page.getByRole("button", { name: "＋ PRD 작성", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "초안 복원", exact: true }),
  ).toHaveCount(0);
});

test("변경 검토·검수·릴리스·일정과 휴지통을 같은 서비스에서 처리한다", async ({
  page,
  request,
}) => {
  const project = await post(request, "projects", {
    data: {
      id: "flow-project",
      name: "검토 릴리스 테스트",
      goal: "",
      repositories: ["org/repo"],
    },
  });
  const policy = await post(request, "knowledge", {
    data: {
      id: "flow-policy",
      kind: "policy",
      name: "릴리스 검증 정책",
      content: "기존 정책",
    },
  });
  const prd = await post(request, "requirements", {
    data: {
      id: "flow-prd",
      project: project.data.id,
      featureName: "검수할 기능",
      policyIds: [policy.data.id],
    },
  });
  await post(request, "requirements/convert", {
    entries: [{ id: prd.data.id, revision: prd.revision }],
  });
  await post(request, "knowledge", {
    data: {
      id: policy.data.id,
      kind: "policy",
      name: policy.data.name,
      content: "수정된 정책",
    },
    revision: policy.revision,
  });
  const changes = await (
      await request.get("/api/workflow/changes?project=flow-project")
    ).json(),
    change = changes.items[0],
    target = change.data.targets.find((t: any) => t.kind === "task");
  let dash = await (await request.get("/api/dashboard")).json(),
    task = dash.tasks.find((t: any) => t.data.id === target.id);
  await post(request, "workflow/changes/update", {
    id: change.data.id,
    revision: change.revision,
    target: target.id,
    kind: "task",
    targetRecordRevision: target.recordRevision,
    status: "applied",
    targetRevision: task.revision,
    patch: { description: "명시적으로 확인한 정책 반영" },
  });
  dash = await (await request.get("/api/dashboard")).json();
  task = dash.tasks.find((t: any) => t.data.id === target.id);
  task = await post(request, "tasks", {
    data: { ...task.data, status: "done" },
    revision: task.revision,
  });
  const review = await post(request, "workflow/reviews/request", {
    task: task.data.id,
    taskRevision: task.revision,
    reviewerId: fixture().pmId,
  });
  await post(request, "workflow/reviews/decide", {
    id: review.data.id,
    revision: review.revision,
    status: "approved",
    note: "기획 의도와 일치함",
  });
  const date = new Date().toISOString().slice(0, 10);
  await post(request, "workflow/releases", {
    id: "flow-release",
    project: project.data.id,
    version: "v1.0",
    plannedDate: date,
    actualDate: date,
    status: "released",
    taskIds: [task.data.id],
  });
  await post(request, "tasks", {
    data: {
      id: "flow-a",
      project: project.data.id,
      title: "선행 일정",
      startDate: "2026-11-09",
      dueDate: "2026-11-10",
    },
  });
  await post(request, "tasks", {
    data: {
      id: "flow-b",
      project: project.data.id,
      title: "후속 일정",
      startDate: "2026-11-11",
      dueDate: "2026-11-12",
      dependsOn: ["flow-a"],
    },
  });
  const preview = await post(request, "workflow/schedule/preview", {
    task: "flow-a",
    days: 3,
  });
  expect(preview.changes.find((t: any) => t.id === "flow-b").dueDate).toBe(
    "2026-11-15",
  );
  await post(request, "workflow/schedule/apply", {
    task: "flow-a",
    days: 3,
    previewHash: preview.previewHash,
    selected: ["flow-a", "flow-b"],
  });
  await page.goto("/");
  await page
    .getByLabel("프로젝트 필터", { exact: true })
    .selectOption(project.data.id);
  await page.getByRole("button", { name: "검토·릴리스", exact: true }).click();
  await page.getByText("변경 전후 비교", { exact: true }).click();
  await expect(page.getByText("수정된 정책", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "기획 검수", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "검토와 릴리스", exact: true })
      .getByText("기획 의도와 일치함", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "일정·릴리스", exact: true }).click();
  await expect(page.getByText("v1.0", { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: resolve(process.env.PLANNING_E2E_DIR!, "workflow-mobile.png"),
    fullPage: true,
  });
  // 프로젝트 삭제·복원은 새 업무 기록과 하위 태스크까지 같은 묶음이다.
  await post(request, "manage/delete", {
    kind: "project",
    entries: [{ id: project.data.id, revision: project.revision }],
  });
  const trash = await (await request.get("/api/trash")).json();
  const batch = trash.items.find((t: any) =>
    t.names.includes(project.data.name),
  );
  expect(batch).toBeTruthy();
  await post(request, "trash/restore", { id: batch.id });
  const releases = await (
    await request.get("/api/workflow/releases?project=flow-project")
  ).json();
  expect(releases.items[0].data.status).toBe("released");
  expect(
    (
      await (
        await request.get(
          "/api/workflow/summary?project=flow-project&period=day",
        )
      ).json()
    ).activity.approved,
  ).toBe(1);
});

class MemoryProvider implements OAuthClientProvider {
  readonly redirectUrl = "https://client.example/callback";
  readonly clientMetadata = {
    redirect_uris: [this.redirectUrl],
    client_name: "공식 SDK 통합 검사",
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "cloud-pm:read cloud-pm:write",
  };
  info: Awaited<ReturnType<OAuthClientProvider["clientInformation"]>>;
  saved: Awaited<ReturnType<OAuthClientProvider["tokens"]>>;
  authorization?: URL;
  verifier = "";
  clientInformation() {
    return this.info;
  }
  saveClientInformation(info: NonNullable<MemoryProvider["info"]>) {
    this.info = info;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(tokens: NonNullable<MemoryProvider["saved"]>) {
    this.saved = tokens;
  }
  redirectToAuthorization(url: URL) {
    this.authorization = url;
  }
  saveCodeVerifier(value: string) {
    this.verifier = value;
  }
  codeVerifier() {
    return this.verifier;
  }
}
test("공식 MCP SDK가 OAuth 발견·등록·동의·PKCE 교환 후 읽기와 쓰기를 구분한다", async ({
  page,
  request,
}) => {
  for (const write of [false, true]) {
    const provider = new MemoryProvider(),
      url = new URL("http://127.0.0.1:3105/api/mcp");
    const first = new Client({ name: "oauth-check", version: "1" }),
      transport = new StreamableHTTPClientTransport(url, {
        authProvider: provider,
      });
    await expect(first.connect(transport)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(provider.authorization).toBeTruthy();
    await page.route("https://client.example/callback**", (route) =>
      route.fulfill({ body: "연결 완료" }),
    );
    await page.goto(provider.authorization!.toString());
    await expect(
      page.getByRole("heading", { name: "MCP 계정 연결", exact: true }),
    ).toBeVisible();
    if (write)
      await page
        .getByRole("checkbox", {
          name: "태스크·PRD·정책 등 업무 데이터 수정도 허용",
          exact: true,
        })
        .check();
    await page.getByRole("button", { name: "연결 허용", exact: true }).click();
    await page.waitForURL("https://client.example/callback**");
    const code = new URL(page.url()).searchParams.get("code")!;
    await transport.finishAuth(code);
    const client = new Client({ name: "oauth-check", version: "1" }),
      ready = new StreamableHTTPClientTransport(url, {
        authProvider: provider,
      });
    try {
      await client.connect(ready);
      const tools = await client.listTools();
      expect(tools.tools.some((t) => t.name === "get_pm_summary")).toBeTruthy();
      expect(tools.tools.some((t) => t.name === "save_release")).toBe(write);
      const summary = await client.callTool({
        name: "get_pm_summary",
        arguments: { project: "browser-project", period: "day" },
      });
      expect(summary.isError).not.toBe(true);
      if (write) {
        const saved = await client.callTool({
          name: "save_milestone",
          arguments: {
            id: "sdk-milestone",
            project: "browser-project",
            name: "SDK로 만든 계획",
            targetDate: "2026-11-30",
            taskIds: [],
          },
        });
        expect(saved.isError).not.toBe(true);
      }
      const grants = await (
        await request.get("/api/auth/mcp/oauth/connections")
      ).json();
      const grant = grants.items.find(
        (g: any) => g.role === (write ? "write" : "read"),
      );
      expect(grant).toBeTruthy();
      const revoked = await request.post("/api/auth/mcp/oauth/disconnect", {
        data: { id: grant.id },
      });
      expect(revoked.ok()).toBeTruthy();
      const denied = await request.post("/api/mcp", {
        headers: { Authorization: `Bearer ${provider.saved!.access_token}` },
        data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      });
      expect(denied.status()).toBe(401);
    } finally {
      await client.close();
      await first.close();
    }
  }
});
