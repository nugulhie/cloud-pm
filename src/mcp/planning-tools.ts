import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Service } from "../core/service";
import { id } from "../core/model";
import { issueAssigneesInput } from "../core/issue-assignees";
import {
  planningPage,
  taskFilters,
  assignmentInput,
  capacityInput,
  savedViewInput,
  sprintInput,
} from "../core/planning-model";
export function registerPlanningTools(server: McpServer, service: Service) {
  if (service.actor.role === "write")
    server.registerTool(
      "update_github_issue_assignees",
      {
        description:
          "GitHub 원본 이슈 담당자를 변경·해제한다. 사용자의 명시적 변경 요청에만 실행. expectedUpdatedAt은 최신 원본 시각. 선택 task는 승인 연결 태스크이며 함께 변경할 때만 지정. 부분 성공·원격 응답 유실은 자동 재시도하지 않는다.",
        inputSchema: issueAssigneesInput.shape,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: true,
        },
      },
      async (input) => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              await service.updateIssueAssignees(input),
              null,
              2,
            ),
          },
        ],
      }),
    );
  const register = (
    name: string,
    operation: string,
    description: string,
    schema: z.ZodRawShape,
    write = false,
  ) => {
    if (write && service.actor.role !== "write") return;
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema,
        annotations: {
          readOnlyHint: !write,
          destructiveHint: operation.endsWith("/delete"),
          openWorldHint: false,
        },
      },
      async (input) => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              await (write
                ? service.writePlanning(operation, input)
                : service.readPlanning(operation, input)),
              null,
              2,
            ),
          },
        ],
      }),
    );
  };
  register(
    "list_workspace_people",
    "people",
    "워크스페이스의 서비스 계정·검증된 GitHub 계정과 프로젝트 참여 가능 담당자 조회. 토큰·개인 저장소 목록은 제외.",
    { project: id.optional(), ...planningPage },
  );
  register(
    "list_assignee_mappings",
    "assignments",
    "외부 담당자 문자열과 내부 계정의 명시적 매칭표 조회",
    {},
  );
  register(
    "save_assignee_mapping",
    "assignments",
    "관리자가 담당자 이름을 워크스페이스 계정에 연결. 최신 revision 필요, 새 항목은 0.",
    assignmentInput.shape,
    true,
  );
  register(
    "delete_assignee_mapping",
    "assignments/delete",
    "관리자가 담당자 매칭표 항목 삭제",
    { id, revision: z.number().int().positive() },
    true,
  );
  register(
    "set_member_capacity",
    "capacity",
    "본인 또는 관리자가 근무 요일·일일 가용 시간·날짜별 예외를 저장. 0시간은 휴무.",
    capacityInput.shape,
    true,
  );
  register(
    "list_saved_views",
    "views",
    "본인의 개인 보기와 접근 가능한 워크스페이스 공유 필터 조회",
    {},
  );
  register(
    "save_saved_view",
    "views",
    "태스크 필터를 개인 또는 공유 보기로 저장. me는 조회자 본인으로 해석.",
    savedViewInput.shape,
    true,
  );
  register(
    "delete_saved_view",
    "views/delete",
    "본인 보기 또는 관리 권한이 있는 공유 보기 삭제",
    { id, revision: z.number().int().positive() },
    true,
  );
  register(
    "query_tasks",
    "tasks/query",
    "계정·내 작업·스프린트·공수 계획에 사용할 태스크 필터 조회. 설명/YAML은 get_task로 조회.",
    { filters: taskFilters.default({}), ...planningPage },
  );
  register(
    "list_sprints",
    "sprints",
    "접근 가능한 프로젝트의 계획·진행·종료 스프린트와 종료 집계 조회",
    { project: id.optional() },
  );
  register(
    "save_sprint",
    "sprints",
    "스프린트 계획·목표·기간 생성 또는 수정. 수정 시 최신 revision.",
    sprintInput.shape,
    true,
  );
  register(
    "start_sprint",
    "sprints/start",
    "계획 스프린트를 시작하고 최초 태스크 범위를 기록. 프로젝트당 동시 진행 1개.",
    { id, revision: z.number().int().positive() },
    true,
  );
  register(
    "close_sprint",
    "sprints/close",
    "진행 스프린트를 종료하고 완료·취소·미완료 집계 보존. 미완료를 다음 계획 스프린트 또는 null=백로그로 이동.",
    {
      id,
      revision: z.number().int().positive(),
      moveTo: id.nullable().default(null),
    },
    true,
  );
  register(
    "delete_sprint",
    "sprints/delete",
    "계획 스프린트 삭제. 연결 태스크는 삭제하지 않고 백로그로 이동.",
    { id, revision: z.number().int().positive() },
    true,
  );
  register(
    "assign_sprint_tasks",
    "sprints/assign",
    "같은 프로젝트의 선택 태스크를 스프린트 또는 null=백로그에 배정. 최대100개, 각 태스크 revision 필요.",
    {
      project: id,
      sprintId: id.nullable(),
      entries: z
        .array(z.object({ id, revision: z.number().int().positive() }))
        .min(1)
        .max(100),
    },
    true,
  );
  register(
    "get_backlog",
    "backlog",
    "프로젝트의 스프린트 미배정 미완료 태스크를 저장한 순서로 조회",
    { project: id, ...planningPage },
  );
  register(
    "reorder_backlog",
    "backlog/reorder",
    "태스크를 beforeTaskId 앞으로 이동. null은 맨 뒤. 다른 페이지의 순서 보존, order revision 필요.",
    {
      project: id,
      taskId: id,
      beforeTaskId: id.nullable(),
      revision: z.number().int().min(0),
    },
    true,
  );
  register(
    "get_resource_plan",
    "resources",
    "최대93일의 담당자별 예정 공수·가용 시간·과부하와 미산정·미매칭 태스크 조회. 실제 근무 시간과 구분.",
    {
      project: id.optional(),
      from: z.iso.date(),
      to: z.iso.date(),
      ...planningPage,
    },
  );
}
