import { writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Store } from "../../src/db/store";
import { Users } from "../../src/users/service";
import { Service } from "../../src/core/service";
import { encryptToken } from "../../src/users/crypto";
import { parseGitHubItem } from "../../src/github/items";
export default async function setupPlanningBrowser() {
  const directory = process.env.PLANNING_E2E_DIR;
  if (!directory) throw new Error("Use playwright.planning.config.ts");
  Object.assign(process.env, {
    TOKEN_ENCRYPTION_KEY: "ab".repeat(32),
    DEMO_MODE: "false",
    GITHUB_ORG: "org",
  });
  mkdirSync(directory, { recursive: true });
  const store = new Store(undefined, join(directory, "db")),
    users = new Users(store);
  try {
    const pm = await users.register({
        login: "planning-pm",
        displayName: "브라우저 PM",
        password: "synthetic-browser-password",
      }),
      dev = await users.register({
        login: "browser-dev",
        displayName: "개발자 한명",
        password: "synthetic-browser-password",
      });
    await store.query(
      "UPDATE app_users SET repositories='[\"org/repo\"]'::jsonb WHERE id=ANY($1::text[])",
      [[pm.user.id, dev.user.id]],
    );
    await store.query(
      "UPDATE app_users SET github_id='101',github_login='developer',github_org='org',github_org_verified_at=now() WHERE id=$1",
      [dev.user.id],
    );
    await store.query(
      "INSERT INTO workspace_github(workspace_id,github_cipher,github_last4,github_login,repositories,permissions_at) VALUES('main',$1,'test','fixture','[\"org/repo\"]'::jsonb,now()+interval '1 year')",
      [encryptToken("synthetic-installation-token")],
    );
    const service = new Service(store, {
      name: "planning-pm",
      role: "write",
      workspaceRole: "owner",
      userId: pm.user.id,
      repositories: ["org/repo"],
    });
    await service.saveProject({
      id: "browser-project",
      name: "리소스 검증 제품",
      goal: "",
      featurePrefix: "PLAN1",
      repositories: ["org/repo"],
    });
    await service.saveTask({
      id: "browser-dev-task",
      project: "browser-project",
      title: "리소스 산정 작업",
      assigneeUserId: dev.user.id,
      startDate: "2026-11-09",
      dueDate: "2026-11-10",
      estimatedHours: 20,
      storyPoints: 5,
    });
    await service.saveTask({
      id: "browser-pm-task",
      project: "browser-project",
      title: "PM 일정 작업",
      assigneeUserId: pm.user.id,
      startDate: "2026-11-09",
      dueDate: "2026-11-09",
      estimatedHours: 4,
      priority: "high",
    });
    await service.saveTask({
      id: "browser-legacy-task",
      project: "browser-project",
      title: "가져온 담당자 작업",
      assignee: "Asana 이름",
    });
    await store.upsert(
      "github",
      "org/repo#17",
      parseGitHubItem(
        {
          number: 17,
          title: "Synthetic task",
          body: "Synthetic body",
          user: { login: "author" },
          assignees: [{ login: "developer" }],
          labels: [],
          state: "open",
          html_url: "https://github.com/org/repo/issues/17",
          updated_at: "2026-11-05T01:00:00Z",
        },
        "org/repo",
      ),
      "fixture",
    );
    await service.linkTask("browser-dev-task", "org/repo#17");
    for (const [name, session] of [
      ["pm", pm],
      ["dev", dev],
    ] as const) {
      const file = join(directory, `${name}-storage.json`);
      writeFileSync(
        file,
        JSON.stringify({
          cookies: [
            {
              name: "pm_session",
              value: session.token,
              domain: "127.0.0.1",
              path: "/",
              expires: Math.floor(Date.now() / 1000) + 3600,
              httpOnly: true,
              secure: false,
              sameSite: "Lax",
            },
          ],
          origins: [],
        }),
      );
      chmodSync(file, 0o600);
    }
    writeFileSync(
      join(directory, "fixture.json"),
      JSON.stringify({ pmId: pm.user.id, devId: dev.user.id }),
    );
  } finally {
    await store.close();
  }
}
