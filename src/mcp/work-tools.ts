import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Service } from "../core/service";
import { DomainError, id } from "../core/model";
import { entityPatchSchemas } from "../core/entity-patch";
import { asanaFileInput, asanaImportInput } from "../core/asana-file";
import {
  asanaProjectFileInput,
  asanaProjectImportInput,
} from "../core/asana-project";

const read = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};
const pagination = {
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(40),
};
const result = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});
function page<T>(items: T[], offset: number, limit: number) {
  const hasMore = offset + limit < items.length;
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    offset,
    limit,
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
  };
}
function missing(): never {
  throw new DomainError("항목이 없거나 접근할 수 없습니다.", 404);
}

export function registerWorkTools(server: McpServer, service: Service) {
  server.registerTool(
    "list_projects",
    {
      description:
        "접근 가능한 프로젝트의 이름·목표·저장소·일정과 수정 revision 조회. 검색·페이지 지원.",
      inputSchema: { query: z.string().max(200).optional(), ...pagination },
      annotations: read,
    },
    async ({ query, offset, limit }) => {
      const data = await service.dashboard();
      return result(
        page(
          data.projects.filter(
            (row) =>
              !query ||
              `${row.data.id} ${row.data.name} ${row.data.goal}`
                .toLowerCase()
                .includes(query.toLowerCase()),
          ),
          offset,
          limit,
        ),
      );
    },
  );
  for (const [tool, key, description] of [
    ["get_project", "projects", "프로젝트 상세와 최신 revision 조회"],
    [
      "get_task",
      "tasks",
      "기능·태스크 상세와 최신 revision 조회. feature는 내부 호환 식별자",
    ],
    ["get_requirement", "requirements", "PRD 상세와 최신 revision 조회"],
    ["get_knowledge", "knowledge", "정책·용어집 상세와 최신 revision 조회"],
  ] as const) {
    server.registerTool(
      tool,
      { description, inputSchema: { id }, annotations: read },
      async ({ id }) => {
        const data = await service.dashboard();
        return result(data[key].find((row) => row.data.id === id) ?? missing());
      },
    );
  }
  server.registerTool(
    "list_github_activities",
    {
      description:
        "수집된 PR·이슈를 GitHub 변경 최신순으로 검색. 프로젝트 연결 저장소·작성자·담당자·리뷰 요청·라벨·상태 필터와 페이지 지원. 기본값은 종료/머지 숨김. 파일 diff는 상세 도구에서 조회. GitHub 원본에 쓰지 않는다.",
      inputSchema: {
        project: id.optional(),
        kind: z.enum(["pr", "issue"]).optional(),
        repository: z.string().max(300).optional(),
        query: z.string().max(300).optional(),
        author: z.string().max(100).optional(),
        assignee: z.string().max(100).optional(),
        reviewer: z.string().max(100).optional(),
        label: z.string().max(100).optional(),
        state: z.enum(["open", "closed", "merged"]).optional(),
        hideClosed: z.boolean().default(true),
        includeBody: z.boolean().default(false),
        ...pagination,
      },
      annotations: read,
    },
    async ({
      project,
      kind,
      repository,
      query,
      author,
      assignee,
      reviewer,
      label,
      state,
      hideClosed,
      includeBody,
      offset,
      limit,
    }) => {
      const data = await service.dashboard();
      const scope = project
        ? (data.projects.find((row) => row.data.id === project)?.data ??
          missing())
        : null;
      const rows = data.items
        .filter(
          ({ data: item }) =>
            (!scope ||
              scope.repositories.some(
                (repo) => repo.toLowerCase() === item.repository.toLowerCase(),
              )) &&
            (!kind || item.kind === kind) &&
            (!repository ||
              item.repository.toLowerCase() === repository.toLowerCase()) &&
            (!state
              ? !hideClosed || item.state === "open"
              : item.state === state) &&
            (!author || item.author.toLowerCase() === author.toLowerCase()) &&
            (!assignee ||
              item.assignees.some(
                (name) => name.toLowerCase() === assignee.toLowerCase(),
              )) &&
            (!reviewer ||
              [...item.reviewers, ...(item.reviewerTeams ?? [])].some(
                (name) => name.toLowerCase() === reviewer.toLowerCase(),
              )) &&
            (!label ||
              item.labels?.some(
                (value) => value.name.toLowerCase() === label.toLowerCase(),
              )) &&
            (!query ||
              `${item.title} ${item.number} ${item.labels?.map((value) => value.name).join(" ")}`
                .toLowerCase()
                .includes(query.toLowerCase())),
        )
        .sort(
          (a, b) =>
            b.data.updatedAt.localeCompare(a.data.updatedAt) ||
            a.data.id.localeCompare(b.data.id),
        );
      const selected = page(rows, offset, limit);
      return result({
        ...selected,
        items: selected.items.map((row) => {
          const { body, ...metadata } = row.data;
          return {
            ...row,
            data: {
              ...metadata,
              ...(includeBody ? { body } : { bodyPreview: body.slice(0, 300) }),
            },
          };
        }),
        collection: data.collection,
      });
    },
  );
  server.registerTool(
    "get_github_activity",
    {
      description:
        "수집된 이슈 또는 PR의 본문·라벨·담당자·리뷰·파일 변경 상세 조회. id는 owner/repo#123.",
      inputSchema: { id: z.string().max(300) },
      annotations: read,
    },
    async ({ id }) => result(await service.githubItem(id)),
  );
  server.registerTool(
    "list_task_links",
    {
      description:
        "작업과 GitHub 항목의 연결 및 승인·제안·거절 상태 조회. task 또는 project로 범위 지정.",
      inputSchema: {
        task: id.optional(),
        project: id.optional(),
        status: z.enum(["suggested", "approved", "rejected"]).optional(),
        ...pagination,
      },
      annotations: read,
    },
    async ({ task, project, status, offset, limit }) => {
      const data = await service.dashboard();
      if (project && !data.projects.some((row) => row.data.id === project))
        missing();
      if (task && !data.tasks.some((row) => row.data.id === task)) missing();
      const tasks = new Set(
        data.tasks
          .filter((row) => !project || row.data.project === project)
          .map((row) => row.data.id),
      );
      return result(
        page(
          data.links.filter(
            (row) =>
              tasks.has(row.data.task) &&
              (!task || row.data.task === task) &&
              (!status || row.data.status === status),
          ),
          offset,
          limit,
        ),
      );
    },
  );
  server.registerTool(
    "list_change_history",
    {
      description:
        "현재 사용자가 접근 가능한 최근 변경 이력 조회. 대상 식별자·종류·작업자로 필터. 서버가 제공한 최근 이력 범위 안에서 페이지 처리.",
      inputSchema: {
        targetId: z.string().max(300).optional(),
        kind: z.string().max(100).optional(),
        actor: z.string().max(100).optional(),
        ...pagination,
      },
      annotations: read,
    },
    async ({ targetId, kind, actor, offset, limit }) =>
      result(
        page(
          (await service.history()).filter(
            (row) =>
              (!targetId || row.targetId === targetId) &&
              (!kind || row.kind === kind) &&
              (!actor || row.actor === actor),
          ),
          offset,
          limit,
        ),
      ),
  );
  server.registerTool(
    "get_project_schedule",
    {
      description:
        "프로젝트 시작·종료일과 작업별 기한 조회. 작업 기간 타임라인은 제공하지 않는다. 일정 수정은 update_project_fields 또는 update_task_fields 사용.",
      inputSchema: { project: id },
      annotations: read,
    },
    async ({ project }) => {
      const data = await service.dashboard();
      const row =
        data.projects.find((row) => row.data.id === project) ?? missing();
      return result({
        project: row,
        tasks: data.tasks
          .filter((row) => row.data.project === project)
          .map((row) => ({
            id: row.data.id,
            title: row.data.title,
            assignee: row.data.assignee,
            status: row.data.status,
            dueDate: row.data.dueDate,
            revision: row.revision,
          })),
      });
    },
  );
  server.registerTool(
    "preview_delete_entities",
    {
      description:
        "삭제할 프로젝트·작업과 연쇄 삭제되는 작업·PRD·GitHub 연결 수, 선행 참조 차단 미리보기. 쓰기 없음. 실행 직전 delete_entities가 권한·revision·관계를 다시 검사한다.",
      inputSchema: {
        kind: z.enum(["project", "feature", "task"]),
        ids: z.array(id).min(1).max(100),
      },
      annotations: read,
    },
    async (input) => result(await service.previewEntityDeletion(input)),
  );
  if (service.actor.role === "write") {
    server.registerTool(
      "preview_asana_project",
      {
        description:
          "Asana CSV/JSON 외부 프로젝트 가져오기 미리보기. 기존 프로젝트 선택 없이 프로젝트 정보와 작업을 함께 확인. 저장소 연결 불필요. 원본 ID/키로 중복 판단.",
        inputSchema: asanaProjectFileInput.shape,
        annotations: read,
      },
      async (input) => result(await service.previewAsanaProject(input)),
    );
    server.registerTool(
      "import_asana_project",
      {
        description:
          "미리 확인한 외부 Asana 프로젝트와 선택 작업을 한 트랜잭션으로 생성/갱신. previewHash와 원본 작업 ids 필요. ids=[]는 프로젝트만 가져오기. 원본 키를 유지하면 프로젝트 중복을 방지.",
        inputSchema: asanaProjectImportInput.shape,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (input) => result(await service.importAsanaProject(input)),
    );
    server.registerTool(
      "preview_asana_file",
      {
        description:
          "Asana CSV/JSON 작업 가져오기 미리보기. 저장하지 않으며 상위 작업·중복·오류와 선택할 원본 ID를 반환. 최대 10 MiB/10,000개. 원격 MCP 전송 크기 제한보다 큰 파일은 웹에서 가져오기.",
        inputSchema: asanaFileInput.shape,
        annotations: read,
      },
      async (input) => result(await service.previewAsanaFile(input)),
    );
    server.registerTool(
      "import_asana_file",
      {
        description:
          "미리 확인한 Asana CSV/JSON의 선택 작업을 원자적으로 가져온다. previewHash와 선택한 Asana 원본 ids 필요. 기존 상태·완료 조건 유지. 원본 완료는 설명에 보존하며 새 작업은 대기.",
        inputSchema: asanaImportInput.shape,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (input) => result(await service.importAsanaFile(input)),
    );
    for (const [kind, patch] of Object.entries(entityPatchSchemas)) {
      server.registerTool(
        `update_${kind}_fields`,
        {
          description: `${kind}의 지정한 필드만 수정. get_${kind}에서 조회한 최신 revision 필요. 생략 필드는 유지하며 빈 patch는 거부. 작업은 status=done으로 직접 완료하거나 재개방할 수 있다. 프로젝트/종류 식별자는 변경하지 않는다.`,
          inputSchema: { id, revision: z.number().int().positive(), patch },
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: false,
          },
        },
        async (input) => result(await service.patchEntity({ kind, ...input })),
      );
    }
  }
}
