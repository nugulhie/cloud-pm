import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
});

test("동명 사용자 지정 열과 빈 이름을 보존하고 모호한 상위는 명시적 선택으로 미연결 가져온다", async ({
  page,
  request,
}) => {
  const name = `custom-columns-${Date.now()}`;
  let project = "";
  const content = [
    [
      "Task ID",
      "Name",
      "Assignee",
      "담당자",
      "Notes",
      "우선순위",
      "우선순위",
      "Parent task",
      "프론트엔드",
      "프론트엔드",
    ],
    [
      "1",
      "같은 부모",
      "기본 담당",
      "별도 담당",
      "설명",
      "1순위",
      "상",
      "",
      "프론트A",
      "",
    ],
    ["2", "같은 부모", "", "", "설명", "", "", "", "", ""],
    ["3", "하위", "", "", "설명", "높음", "상", "같은 부모", "", ""],
    ["4", "", "", "", "설명", "", "", "", "", ""],
  ]
    .map((row) => row.join(","))
    .join("\n");
  try {
    await page.goto("/");
    await page.locator(".overview-tools > summary").click();
    await page
      .getByRole("button", { name: "외부 프로젝트 가져오기", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Asana 프로젝트 가져오기",
    });
    await dialog.getByLabel("Asana 파일", { exact: true }).setInputFiles({
      name: `${name}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(content),
    });
    await dialog
      .getByRole("button", { name: "파일 미리보기", exact: true })
      .click();
    await expect(
      dialog.getByLabel("가져오기: 하위", { exact: true }),
    ).toBeDisabled();
    await expect(dialog).toContainText("동명 사용자 지정 열");
    await dialog
      .getByRole("button", {
        name: "상위 작업을 연결하지 않고 다시 확인",
        exact: true,
      })
      .click();
    await expect(dialog.getByLabel("상위 작업 미확인 처리")).toHaveValue(
      "keep_unlinked",
    );
    await expect(
      dialog.getByLabel("가져오기: 하위", { exact: true }),
    ).toBeChecked();
    await expect(dialog).toContainText("이름 없는 Asana 작업 (4)");
    await dialog
      .getByRole("button", {
        name: "프로젝트와 선택 작업 4개 가져오기",
        exact: true,
      })
      .click();
    await expect(dialog.getByRole("status")).toContainText("작업 4개 추가");
    const data = await (await request.get("/api/dashboard")).json();
    project = data.projects.find(
      (row: { data: { name: string } }) => row.data.name === name,
    ).data.id;
    const tasks = data.tasks.filter(
      (row: { data: { project: string } }) => row.data.project === project,
    );
    expect(tasks).toHaveLength(4);
    const parent = tasks.find(
      (row: { data: { assignee: string } }) =>
        row.data.assignee === "기본 담당",
    );
    expect(parent.data.description).toContain("담당자 [4열]: 별도 담당");
    expect(parent.data.description).toContain("프론트엔드 [9열]: 프론트A");
    expect(
      tasks.find(
        (row: { data: { title: string } }) => row.data.title === "하위",
      ).data.parentId,
    ).toBeNull();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  } finally {
    if (project) {
      const data = await (await request.get("/api/dashboard")).json();
      const row = data.projects.find(
        (entry: { data: { id: string } }) => entry.data.id === project,
      );
      await request.post("/api/manage/delete", {
        data: {
          kind: "project",
          entries: [{ id: project, revision: row.revision }],
        },
      });
    }
  }
});

test("6,001개 미리보기는 50개씩 표시하고 모든 페이지의 선택·상위 작업 검사를 유지한다", async ({
  page,
}) => {
  test.setTimeout(90000);
  const count = 6001;
  const notes = "상세 정책 ".repeat(45);
  const sourceId = `large-preview-${Date.now()}`;
  const fileContent =
    "Task ID,Name,Project ID,Project Name,Parent Task,Notes\n" +
    Array.from(
      { length: count },
      (_, i) =>
        `${1000 + i},대량 작업 ${i},${sourceId},대량 프로젝트,${i === 0 ? "1050" : ""},${notes}`,
    ).join("\n");
  expect(Buffer.byteLength(fileContent)).toBeGreaterThan(3 * 1024 * 1024);
  await page.goto("/");
  await page.locator(".overview-tools > summary").click();
  await page
    .getByRole("button", { name: "외부 프로젝트 가져오기", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Asana 프로젝트 가져오기" });
  await dialog.getByLabel("Asana 파일", { exact: true }).setInputFiles({
    name: "large.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(fileContent),
  });
  await dialog
    .getByRole("button", { name: "파일 미리보기", exact: true })
    .click();
  await expect(dialog.locator("tbody tr")).toHaveCount(50);
  await expect(
    dialog.getByRole("button", {
      name: "프로젝트와 선택 작업 6001개 가져오기",
      exact: true,
    }),
  ).toBeEnabled();
  const pages = dialog.getByRole("navigation", {
    name: "Asana 미리보기 페이지",
  });
  await expect(pages).toContainText("1 / 121 페이지");
  await pages.getByRole("button", { name: "다음 페이지", exact: true }).click();
  await dialog.getByLabel("가져오기: 대량 작업 50", { exact: true }).uncheck();
  await expect(dialog.getByRole("alert")).toContainText(
    "상위 작업도 함께 선택",
  );
  await expect(
    dialog.getByRole("button", {
      name: "프로젝트와 선택 작업 6000개 가져오기",
      exact: true,
    }),
  ).toBeDisabled();
  await pages.getByRole("button", { name: "이전 페이지", exact: true }).click();
  await expect(
    dialog.getByLabel("가져오기: 대량 작업 0", { exact: true }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "선택 해제", exact: true }).click();
  await expect(
    dialog.getByRole("button", {
      name: "프로젝트와 선택 작업 0개 가져오기",
      exact: true,
    }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "정상 항목 전체 선택", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", {
      name: "프로젝트와 선택 작업 6001개 가져오기",
      exact: true,
    }),
  ).toBeEnabled();
  await pages.getByRole("button", { name: "다음 페이지", exact: true }).click();
  await expect(
    dialog.getByLabel("가져오기: 대량 작업 50", { exact: true }),
  ).toBeChecked();
});

test("Asana CSV·JSON 파일을 선택·중복 유지·갱신으로 가져오고 모바일에서 확인한다", async ({
  page,
  request,
}) => {
  const name = `Asana 외부 프로젝트 ${Date.now()}`;
  const sourceProjectId = String(Date.now());
  let importedProject = "";
  let firstDashboard = true;
  await page.route("**/api/dashboard", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    if (firstDashboard) {
      firstDashboard = false;
      data.projects = [];
      data.tasks = [];
      data.features = [];
    }
    await route.fulfill({ json: data });
  });
  try {
    await page.goto("/");
    await page.locator(".overview-tools > summary").click();
    const entry = page.getByRole("button", {
      name: "외부 프로젝트 가져오기",
      exact: true,
    });
    await expect(entry).toBeEnabled();
    await entry.click();
    const dialog = page.getByRole("dialog", {
      name: "Asana 프로젝트 가져오기",
    });
    await expect(dialog.getByLabel("Asana 대상 프로젝트")).toHaveCount(0);
    await expect(
      dialog.getByLabel("Asana 파일", { exact: true }),
    ).toBeEnabled();
    await dialog.getByLabel("Asana 파일", { exact: true }).setInputFiles({
      name: "asana.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        `Task ID,Name,Notes,Assignee,Due Date,Parent Task,Completed At,Projects\n101,로그인 기획,설명,pm,2026-11-20,,,${name}\n102,로그인 검토,검토 설명,reviewer,2026-11-21,로그인 기획,2026-10-29,${name}`,
      ),
    });
    await expect(
      dialog.getByRole("button", { name: "파일 미리보기", exact: true }),
    ).toBeEnabled();
    await dialog
      .getByRole("button", { name: "파일 미리보기", exact: true })
      .click();
    await expect(
      dialog.getByRole("region", { name: "Asana 가져오기 미리보기" }),
    ).toContainText("Asana 완료");
    await dialog.getByLabel("가져오기: 로그인 기획", { exact: true }).uncheck();
    await expect(dialog.getByRole("alert")).toContainText(
      "상위 작업도 함께 선택",
    );
    await expect(
      dialog.getByRole("button", {
        name: "프로젝트와 선택 작업 1개 가져오기",
        exact: true,
      }),
    ).toBeDisabled();
    await dialog.getByLabel("가져오기: 로그인 기획", { exact: true }).check();
    await dialog
      .getByRole("button", {
        name: "프로젝트와 선택 작업 2개 가져오기",
        exact: true,
      })
      .click();
    await expect(dialog.getByRole("status")).toContainText("작업 2개 추가");
    const current = await (await request.get("/api/dashboard")).json();
    const imported = current.projects.find(
      (row: { data: { name: string } }) => row.data.name === name,
    );
    expect(imported).toBeTruthy();
    importedProject = imported.data.id;
    expect(imported.data.repositories).toEqual([]);

    await dialog
      .getByRole("button", { name: "파일 미리보기", exact: true })
      .click();
    await dialog
      .getByRole("button", {
        name: "프로젝트와 선택 작업 2개 가져오기",
        exact: true,
      })
      .click();
    await expect(dialog.getByRole("status")).toContainText(
      "2개 건너뛰었습니다",
    );
    await expect(
      dialog.getByLabel("Asana 파일", { exact: true }),
    ).toBeEnabled();
    await dialog.getByLabel("Asana 파일", { exact: true }).setInputFiles({
      name: "asana.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          project: { gid: sourceProjectId, name },
          data: [{ gid: "101", name: "로그인 기획 수정", notes: "갱신 설명" }],
        }),
      ),
    });
    await dialog.getByLabel("Asana 중복 처리").selectOption("update");
    await dialog
      .getByRole("button", { name: "파일 미리보기", exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBeTruthy();
    await expect(
      dialog.getByRole("button", {
        name: "프로젝트와 선택 작업 1개 가져오기",
        exact: true,
      }),
    ).toBeInViewport();
    await page.screenshot({ path: "test-results/asana-import-mobile.png" });
    await dialog
      .getByRole("button", {
        name: "프로젝트와 선택 작업 1개 가져오기",
        exact: true,
      })
      .click();
    await expect(dialog.getByRole("status")).toContainText("1개 갱신");
    expect(
      (await (await request.get("/api/dashboard")).json()).projects.filter(
        (row: { data: { name: string } }) => row.data.name === name,
      ),
    ).toHaveLength(1);
    await dialog
      .getByRole("button", { name: "닫기", exact: true })
      .last()
      .click();
    const dashboard = await (await request.get("/api/dashboard")).json();
    const tasks = dashboard.tasks.filter(
      (row: { data: { project: string } }) =>
        row.data.project === importedProject,
    );
    expect(tasks).toHaveLength(2);
    const updated = tasks.find(
      (row: { data: { title: string } }) =>
        row.data.title === "로그인 기획 수정",
    );
    expect(updated.data.assignee).toBe("pm");
    expect(updated.data.dueDate).toBe("2026-11-20");
    expect(
      tasks.every(
        (row: { data: { status: string } }) => row.data.status === "backlog",
      ),
    ).toBeTruthy();
  } finally {
    const data = await (await request.get("/api/dashboard")).json();
    const row = data.projects.find(
      (row: { data: { id: string } }) => row.data.id === importedProject,
    );
    if (row)
      expect(
        (
          await request.post("/api/manage/delete", {
            data: {
              kind: "project",
              entries: [{ id: importedProject, revision: row.revision }],
            },
          })
        ).ok(),
      ).toBeTruthy();
  }
});

test("외부 프로젝트 API는 기존 대상 없이 대용량 미리보기와 출처 차단을 적용한다", async ({
  request,
}) => {
  const name = `대용량 외부 Asana ${Date.now()}`;
  const content = JSON.stringify({
    project: { gid: String(Date.now()), name },
    data: Array.from({ length: 35 }, (_, index) => ({
      gid: String(1000 + index),
      name: `작업 ${index}`,
      notes: "설명".repeat(1800),
    })),
  });
  expect(Buffer.byteLength(content)).toBeGreaterThan(100000);
  const body = { fileName: "large.json", format: "json", content };
  const preview = await request.post("/api/projects/import/asana/preview", {
    data: body,
  });
  expect(preview.status()).toBe(200);
  const data = await preview.json();
  expect(data.counts.total).toBe(35);
  expect(data.counts.invalid).toBe(0);
  expect(data.projectInfo.existing).toBeNull();
  const dashboard = await (await request.get("/api/dashboard")).json();
  expect(
    dashboard.projects.some(
      (row: { data: { name: string } }) => row.data.name === name,
    ),
  ).toBeFalsy();
  const forbidden = await request.post("/api/projects/import/asana", {
    headers: { Origin: "https://outside.invalid" },
    data: {
      ...body,
      mode: "skip",
      previewHash: data.previewHash,
      ids: ["1000"],
    },
  });
  expect(forbidden.status()).toBe(403);
});

test("작업 없는 Asana 프로젝트를 가져오고 저장소 없이 현황에서 확인한다", async ({
  page,
  request,
}) => {
  const name = `빈 외부 프로젝트 ${Date.now()}`;
  let id = "";
  try {
    await page.goto("/");
    await page.locator(".overview-tools > summary").click();
    await page
      .getByRole("button", { name: "외부 프로젝트 가져오기", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Asana 프로젝트 가져오기",
    });
    await dialog.getByLabel("Asana 파일", { exact: true }).setInputFiles({
      name: "empty.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          project: { gid: String(Date.now()), name },
          tasks: [],
        }),
      ),
    });
    await dialog
      .getByRole("button", { name: "파일 미리보기", exact: true })
      .click();
    const button = dialog.getByRole("button", {
      name: "프로젝트와 선택 작업 0개 가져오기",
      exact: true,
    });
    await expect(button).toBeEnabled();
    await button.click();
    await expect(dialog.getByRole("status")).toContainText(
      "프로젝트를 만들었습니다",
    );
    const data = await (await request.get("/api/dashboard")).json();
    const project = data.projects.find(
      (row: { data: { name: string } }) => row.data.name === name,
    );
    expect(project).toBeTruthy();
    id = project.data.id;
    expect(project.data.repositories).toEqual([]);
    await dialog
      .getByRole("button", { name: "닫기", exact: true })
      .last()
      .click();
    await expect(page.getByLabel("프로젝트 필터")).toHaveValue(id);
    await expect(
      page.getByRole("button", { name: "↻ GitHub 수동 동기화", exact: true }),
    ).toBeDisabled();
    await expect(
      page.locator(".projects > div").filter({ hasText: name }),
    ).toContainText("GitHub 저장소 미연결");
  } finally {
    if (id) {
      const data = await (await request.get("/api/dashboard")).json();
      const row = data.projects.find(
        (row: { data: { id: string } }) => row.data.id === id,
      );
      if (row)
        expect(
          (
            await request.post("/api/manage/delete", {
              data: {
                kind: "project",
                entries: [{ id, revision: row.revision }],
              },
            })
          ).ok(),
        ).toBeTruthy();
    }
  }
});
