import { isDependencyBlocked } from "../core/dependencies";
import { registerWorkTools } from "./work-tools";
import { knowledgeInput } from "../core/knowledge-model";
import { knowledgeImpactQuery } from "../core/knowledge-impact";
import { csvFileInput, csvImportInput } from "../core/requirement-csv";
import { commentInput } from "../core/collaboration";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Service } from "../core/service";
import { projectSchema, featureSchema, taskSchema } from "../core/model";
import {
  requirementInput,
  conversionInput,
  publishInput,
  requirementEntries,
} from "../core/requirement-model";
function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}
export function createMcpServer(service: Service) {
  const server = new McpServer({ name: "cloud-pm-agent", version: "0.1.0" });
  registerWorkTools(server, service);
  const read = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  };
  server.registerTool(
    "get_knowledge_impact",
    {
      description:
        "정책·용어의 변경 검토 대상 조회. 정책에 의존하는 정책을 따라 관련 PRD·하위 태스크·승인된 이슈·PR도 집계한다. scope=direct는 직접 참조만, 기본 all은 간접 참조도 포함한다. kind=policies로 의존 정책과 경로 조회. project와 offset/limit 지원. 원본을 수정하지 않는다.",
      inputSchema: knowledgeImpactQuery.shape,
      annotations: read,
    },
    async (input) => result(await service.getKnowledgeImpact(input)),
  );
  server.registerTool(
    "list_github_assignees",
    {
      description:
        "프로젝트 저장소에서 이슈를 배정할 수 있는 GitHub 사용자 목록. PRD 담당자와 이슈 발행에 login을 사용한다.",
      inputSchema: { project: z.string(), repository: z.string().optional() },
      annotations: { ...read, openWorldHint: true },
    },
    async (input) => result(await service.listGitHubAssignees(input)),
  );
  server.registerTool(
    "list_knowledge",
    {
      description: "현재 워크스페이스의 정책·용어집 조회",
      inputSchema: {
        kind: z.enum(["policy", "glossary"]).optional(),
        query: z.string().max(300).optional(),
        status: z.enum(["draft", "active", "deprecated"]).optional(),
      },
      annotations: read,
    },
    async ({ kind, query, status }) =>
      result(
        (await service.dashboard()).knowledge.filter(
          (r) =>
            (!kind || r.data.kind === kind) &&
            (!status || r.data.status === status) &&
            (!query ||
              `${r.data.name} ${r.data.content} ${r.data.aliases.join(" ")}`
                .toLowerCase()
                .includes(query.toLowerCase())),
        ),
      ),
  );
  if (service.actor.role === "write") {
    server.registerTool(
      "preview_requirement_csv",
      {
        description:
          "PRD CSV의 열·원본 ID·중복·오류 미리보기. 저장하지 않는다.",
        inputSchema: csvFileInput.shape,
        annotations: read,
      },
      async (input) => result(await service.previewRequirementCsv(input)),
    );
    server.registerTool(
      "import_requirement_csv",
      {
        description:
          "미리 확인한 CSV를 PRD로 가져오기. preview_requirement_csv의 previewHash 필요. skip은 중복 유지, update는 CSV에 존재하는 열만 수정한다.",
        inputSchema: csvImportInput.shape,
      },
      async (input) => result(await service.importRequirementCsv(input)),
    );
    server.registerTool(
      "save_knowledge",
      {
        description:
          "정책·용어집 작성·수정. 정책의 dependsOn에 기준이 되는 정책 ID를 지정한다(최대 50개). 생략하면 기존 연결 유지, []로 해제. 순환·자기 참조는 거절. 편집자·일시는 자동 기록. 수정 시 revision 필요.",
        inputSchema: {
          data: knowledgeInput,
          revision: z.number().int().positive().optional(),
        },
      },
      async ({ data, revision }) =>
        result(await service.saveKnowledge(data, revision)),
    );
    server.registerTool(
      "delete_knowledge",
      {
        description: "PRD나 다른 정책이 참조하지 않는 정책·용어 삭제",
        inputSchema: { id: z.string(), revision: z.number().int().positive() },
        annotations: { destructiveHint: true },
      },
      async (input) => result(await service.deleteKnowledge(input)),
    );
  }
  server.registerTool(
    "list_requirements",
    {
      description: "PRD 요구사항 표와 태스크·GitHub 이슈 연결 조회",
      inputSchema: { project: z.string().optional() },
      annotations: read,
    },
    async ({ project }) => {
      const data = await service.dashboard();
      return result({
        requirements: data.requirements.filter(
          (r) => !project || r.data.project === project,
        ),
        issues: data.requirementIssues.filter(
          (r) => !project || r.data.project === project,
        ),
      });
    },
  );
  if (service.actor.role === "write") {
    server.registerTool(
      "save_requirement",
      {
        description:
          "PRD 작성·수정. 번호·편집일시·편집자는 자동 기록. 수정 시 최신 revision 필요.",
        inputSchema: {
          data: requirementInput,
          revision: z.number().int().positive().optional(),
        },
      },
      async ({ data, revision }) =>
        result(await service.saveRequirement(data, revision)),
    );
    server.registerTool(
      "convert_requirements_to_tasks",
      {
        description:
          "PRD별 기본 태스크 생성. 한 PRD에 여러 작업을 추가하려면 entries 하나와 tasks 배열(id/title/repository/assignee)을 지정한다. 기존 연결은 유지하며 같은 ID는 중복 생성하지 않는다.",
        inputSchema: conversionInput.shape,
      },
      async (input) => result(await service.convertRequirements(input)),
    );
    server.registerTool(
      "delete_requirements",
      {
        description: "태스크·이슈로 연결되지 않은 PRD 삭제",
        inputSchema: { entries: requirementEntries },
        annotations: { destructiveHint: true },
      },
      async ({ entries }) => result(await service.deleteRequirements(entries)),
    );
    server.registerTool(
      "preview_requirement_issue",
      {
        description:
          "PRD의 개별 태스크로 생성할 GitHub 이슈 미리보기. 여러 태스크가 연결된 PRD는 taskId 필수. 태스크의 저장소·제목·설명·담당자를 사용한다. 외부 쓰기 없음.",
        inputSchema: publishInput.shape,
        annotations: read,
      },
      async (input) => result(await service.previewRequirementIssue(input)),
    );
    server.registerTool(
      "publish_requirement_issue",
      {
        description:
          "선택한 PRD의 taskId에 GitHub 이슈를 생성·연결한다. 중복 방지는 태스크별이며 다른 태스크는 별도 저장소에 발행할 수 있다. 사용자가 대상 태스크·저장소와 내용을 확인하고 생성을 요청했을 때만 사용. Issues 쓰기 권한 필요.",
        inputSchema: publishInput.shape,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: true,
          idempotentHint: true,
        },
      },
      async (input) => result(await service.publishRequirementIssue(input)),
    );
  }
  server.registerTool(
    "get_project_status",
    {
      description: "프로젝트별 기능·태스크·개입 필요 항목과 근거 조회",
      inputSchema: {},
      annotations: read,
    },
    async () => result(await service.dashboard()),
  );
  server.registerTool(
    "list_tasks",
    {
      description: "프로젝트·담당자·작업 유형·상위 태스크로 조회",
      inputSchema: {
        project: z.string().optional(),
        assignee: z.string().optional(),
        type: taskSchema.shape.type,
        parentId: taskSchema.shape.parentId,
        dependsOn: z.string().optional(),
        blocked: z.boolean().optional(),
        status: z
          .enum([
            "backlog",
            "ready",
            "in_progress",
            "in_review",
            "done",
            "canceled",
          ])
          .optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        query: z.string().max(300).optional(),
        dueBefore: z.iso.date().optional(),
      },
      annotations: read,
    },
    async ({
      project,
      assignee,
      type,
      parentId,
      dependsOn,
      blocked,
      status,
      priority,
      query,
      dueBefore,
    }) => {
      const d = await service.dashboard();
      return result(
        d.tasks.filter(
          (t) =>
            (!project || t.data.project === project) &&
            (!assignee || t.data.assignee === assignee) &&
            (!type || (t.data.type ?? "feature") === type) &&
            (!status || t.data.status === status) &&
            (!priority || t.data.priority === priority) &&
            (!query ||
              `${t.data.id} ${t.data.title} ${t.data.description}`
                .toLowerCase()
                .includes(query.toLowerCase())) &&
            (!dueBefore || (!!t.data.dueDate && t.data.dueDate < dueBefore)) &&
            (parentId === undefined ||
              (t.data.parentId ?? null) === parentId) &&
            (!dependsOn || t.data.dependsOn?.includes(dependsOn)) &&
            (blocked === undefined ||
              isDependencyBlocked(
                t.data,
                d.tasks.map((r) => r.data),
              ) === blocked),
        ),
      );
    },
  );
  server.registerTool(
    "get_task_dependencies",
    {
      description:
        "태스크 선행·후행 작업과 미완료 선행 작업에 따른 차단 여부 조회",
      inputSchema: { task: z.string() },
      annotations: read,
    },
    async ({ task }) => result(await service.taskDependencies(task)),
  );
  server.registerTool(
    "get_pull_request_changes",
    {
      description: "수집된 PR의 파일별 diff와 작성자 조회",
      inputSchema: {
        repository: z.string(),
        number: z.number().int().positive(),
      },
      annotations: read,
    },
    async ({ repository, number }) => {
      return result(
        await service.githubItem(`${repository.toLowerCase()}#${number}`),
      );
    },
  );
  server.registerTool(
    "list_sync_jobs",
    {
      description: "웹훅 동기화 작업의 처리·재시도 상태 조회",
      inputSchema: {},
      annotations: read,
    },
    async () => result(await service.listSyncJobs()),
  );
  server.registerTool(
    "list_task_comments",
    {
      description: "태스크 댓글과 멘션 가능한 구성원 조회",
      inputSchema: { task: z.string() },
      annotations: read,
    },
    async ({ task }) => result(await service.listComments(task)),
  );
  server.registerTool(
    "list_notifications",
    {
      description: "개인 댓글·멘션 알림과 미읽음 수 조회. 개인 토큰 필요.",
      inputSchema: {},
      annotations: read,
    },
    async () => result(await service.listNotifications()),
  );
  server.registerTool(
    "mark_notification_read",
    {
      description: "본인의 알림 읽음 처리",
      inputSchema: {
        id: z.string().uuid(),
        revision: z.number().int().positive(),
      },
    },
    async (input) => result(await service.readNotification(input)),
  );
  if (service.actor.userId)
    server.registerTool(
      "list_workspaces",
      {
        description:
          "현재 사용자가 참여한 워크스페이스 목록. 현재 연결의 데이터는 발급된 토큰의 워크스페이스로 제한된다.",
        inputSchema: {},
        annotations: read,
      },
      async () => result(await service.listWorkspaces()),
    );
  if (service.actor.role === "write") {
    server.registerTool(
      "add_task_comment",
      {
        description:
          "태스크 Markdown 댓글 작성. @GitHub아이디 멘션 지원. 개인 토큰 필요.",
        inputSchema: {
          task: commentInput.shape.task,
          body: commentInput.shape.body,
        },
      },
      async (input) => result(await service.saveComment(input)),
    );
    server.registerTool(
      "update_task_comment",
      {
        description: "본인 댓글 수정. 현재 revision 필요.",
        inputSchema: {
          ...commentInput.shape,
          id: z.string().uuid(),
          revision: z.number().int().positive(),
        },
      },
      async (input) => result(await service.saveComment(input)),
    );
    server.registerTool(
      "delete_task_comment",
      {
        description: "본인 댓글 삭제",
        inputSchema: {
          id: z.string().uuid(),
          revision: z.number().int().positive(),
        },
      },
      async (input) => result(await service.deleteComment(input)),
    );

    if (service.actor.userId)
      server.registerTool(
        "create_workspace",
        {
          description:
            "별도 프로젝트·멤버를 가진 워크스페이스 생성. 생성 후 웹에서 전환하고 해당 워크스페이스의 개인 MCP 토큰을 발급해 연결한다.",
          inputSchema: {
            name: z.string().trim().min(1).max(100),
            description: z.string().max(2000).optional(),
          },
          annotations: { readOnlyHint: false, destructiveHint: false },
        },
        async (input) => result(await service.createWorkspace(input)),
      );

    server.registerTool(
      "bulk_update_entities",
      {
        description:
          "프로젝트 일정·목표, 기능 목표, 태스크 담당자·우선순위·기한·상태 선택 일괄 수정. patch.status=done으로 일괄 완료 가능. 항목별 처리 결과 반환",
        inputSchema: {
          kind: z.enum(["project", "feature", "task"]),
          entries: z
            .array(
              z.object({
                id: z.string(),
                revision: z.number().int().positive(),
              }),
            )
            .min(1)
            .max(100),
          patch: z.record(z.string(), z.unknown()),
        },
      },
      async (input) => result(await service.bulkUpdate(input)),
    );
    server.registerTool(
      "import_github_items",
      {
        description:
          "선택한 GitHub PR·이슈를 프로젝트의 통합 작업으로 추가 (기능 선택 불필요)",
        inputSchema: {
          project: z.string(),
          feature: z.string().optional(),
          items: z.array(z.string()).min(1).max(100),
        },
      },
      async (input) => result(await service.importItems(input)),
    );
    server.registerTool(
      "delete_entities",
      {
        description: "관리 항목과 하위 태스크·연결 삭제. GitHub 원본 유지",
        annotations: { destructiveHint: true },
        inputSchema: {
          kind: z.enum(["project", "feature", "task"]),
          entries: z
            .array(
              z.object({
                id: z.string(),
                revision: z.number().int().positive(),
              }),
            )
            .min(1)
            .max(100),
        },
      },
      async (input) => result(await service.removeEntities(input)),
    );
    server.registerTool(
      "update_project",
      {
        description: "프로젝트 목표·일정·저장소 수정",
        inputSchema: {
          data: projectSchema,
          revision: z.number().int().positive(),
        },
      },
      async ({ data, revision }) =>
        result(await service.saveProject(data, revision)),
    );
    server.registerTool(
      "update_feature",
      {
        description: "기능 이름·목표 수정",
        inputSchema: {
          data: featureSchema,
          revision: z.number().int().positive(),
        },
      },
      async ({ data, revision }) =>
        result(await service.saveFeature(data, revision)),
    );

    server.registerTool(
      "retry_sync_job",
      {
        description:
          "최대 시도 횟수에 도달한 실패 작업을 다시 대기 상태로 변경",
        inputSchema: { id: z.string().uuid() },
      },
      async ({ id }) => result(await service.retrySyncJob(id)),
    );
    server.registerTool(
      "analyze_project",
      {
        description: "Claude API로 PM 기술 브리핑 생성. 제공자 설정 필요.",
        inputSchema: { project: z.string() },
      },
      async ({ project }) => result(await service.analyzeProject(project)),
    );
    server.registerTool(
      "ai_suggest_task_links",
      {
        description:
          "AI 기반 연결 후보 제안. 사람의 승인 전까지 확정하지 않는다.",
        inputSchema: { task: z.string() },
      },
      async ({ task }) => result(await service.aiSuggestLinks(task)),
    );
    server.registerTool(
      "link_task",
      {
        description: "태스크와 수집된 GitHub 항목을 직접 연결",
        inputSchema: { task: z.string(), item: z.string() },
      },
      async ({ task, item }) => result(await service.linkTask(task, item)),
    );
    server.registerTool(
      "create_project",
      { description: "프로젝트 등록", inputSchema: projectSchema.shape },
      async (input) => result(await service.saveProject(input)),
    );
    server.registerTool(
      "create_feature",
      {
        description:
          "기존 클라이언트용 기능 묶음 등록. 새 기능·태스크는 create_task로 프로젝트 아래 바로 등록하세요.",
        inputSchema: featureSchema.shape,
      },
      async (input) => result(await service.saveFeature(input)),
    );
    server.registerTool(
      "create_task",
      {
        description:
          "통합 기능·태스크 등록. project와 title로 바로 등록하며 feature 선택은 필요 없다. parentId를 지정하면 하위 태스크를 만들고 상위의 내부 연결을 상속한다. status=done으로 직접 완료 가능. YAML 초안과 기본 브랜치 PR 자동 완료도 지원한다.",
        inputSchema: taskSchema.shape,
      },
      async (input) => result(await service.saveTask(input)),
    );
    server.registerTool(
      "update_task",
      {
        description:
          "태스크 갱신. list_tasks에서 조회한 revision 필요. status=done으로 직접 완료하고 다른 상태로 재개방 가능. PR 자동 완료는 유지.",
        inputSchema: {
          data: taskSchema,
          revision: z.number().int().positive(),
        },
      },
      async ({ data, revision }) =>
        result(await service.saveTask(data, revision)),
    );
    server.registerTool(
      "suggest_task_links",
      {
        description: "태스크 제목 키워드로 GitHub 연결 후보 제안",
        inputSchema: { task: z.string() },
      },
      async ({ task }) => result(await service.suggestLinks(task)),
    );
    server.registerTool(
      "decide_task_link",
      {
        description: "연결 후보 승인 또는 거절",
        inputSchema: {
          id: z.string(),
          status: z.enum(["approved", "rejected"]),
          revision: z.number().int().positive(),
        },
      },
      async ({ id, status, revision }) =>
        result(await service.decideLink(id, status, revision)),
    );
    server.registerTool(
      "sync_github",
      {
        description:
          "등록된 저장소의 이슈·PR·파일 변경과 YAML 완료 조건을 수집·평가",
        inputSchema: { project: z.string().optional() },
      },
      async (input) => result(await service.sync(input)),
    );
  }
  return server;
}
