import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Service } from "../core/service";
import { id } from "../core/model";
import { milestoneInput, releaseInput } from "../core/review-model";
import { scheduleInput } from "../core/workflow";
export function registerWorkflowTools(server: McpServer, service: Service) {
  const output = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  });
  const read = (
    name: string,
    operation: string,
    description: string,
    schema: z.ZodRawShape = { project: id.optional() },
  ) =>
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (input) => output(await service.readWorkflow(operation, input)),
    );
  read(
    "get_change_reviews",
    "changes",
    "정책·PRD 변경 전후와 프로젝트별 검토 대상·담당자·처리 상태 조회. 원문이 후속 변경됐으면 최신 검토를 사용한다.",
    {
      project: id.optional(),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
  );
  read(
    "get_task_reviews",
    "reviews",
    "태스크 완료와 별도로 기획 검수·승인·반려 기록을 조회. stale은 검수 후 작업 수정 여부.",
  );
  read(
    "list_milestones",
    "milestones",
    "프로젝트의 목표일과 포함된 태스크를 가진 마일스톤 조회.",
  );
  read(
    "list_releases",
    "releases",
    "계획·실제 릴리스, 배포일·환경·URL·검수 근거 조회.",
  );
  read(
    "get_project_timeline",
    "timeline",
    "태스크 시작일·기한·선행 관계와 마일스톤·릴리스 조회.",
  );
  read(
    "get_pm_summary",
    "summary",
    "현재 권한 범위의 지연·차단·미할당·완료와 기간별 등록·완료 전환·검수 승인 집계. 기본 day, week는 이번 주. 관측 집계이며 AI 예측이 아니다.",
    {
      project: id.optional(),
      period: z.enum(["day", "week", "current"]).optional(),
    },
  );
  read(
    "get_notification_settings",
    "notification-settings",
    "현재 사용자의 업무 알림·일일·주간 요약 설정 조회.",
  );
  server.registerTool(
    "list_deleted_batches",
    {
      description: "현재 접근 가능한 삭제 묶음의 요약과 복구 가능 항목 조회.",
      inputSchema: {
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => output(await service.listTrash(input)),
  );
  server.registerTool(
    "preview_schedule_change",
    {
      description:
        "기준 태스크 일정 변경과 선행 지연에 영향을 받는 후속 일정 미리보기. 달력 기준이며 휴일·가용 공수는 별도 검토. 쓰지 않는다.",
      inputSchema: scheduleInput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) =>
      output(await service.writeWorkflow("schedule/preview", input)),
  );
  if (service.actor.role !== "write") return;
  const write = (
    name: string,
    operation: string,
    description: string,
    schema: z.ZodRawShape,
  ) =>
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: operation.endsWith("delete"),
          openWorldHint: false,
        },
      },
      async (input) => output(await service.writeWorkflow(operation, input)),
    );
  write(
    "request_task_review",
    "reviews/request",
    "완료된 태스크의 현재 revision을 지정한 멤버에게 기획 검수 요청. 재요청은 기존 검수 revision 필요.",
    {
      task: id,
      taskRevision: z.number().int().positive(),
      reviewerId: z.string().uuid(),
      revision: z.number().int().positive().optional(),
      note: z.string().max(2000).optional(),
    },
  );
  write(
    "decide_task_review",
    "reviews/decide",
    "지정된 검토자 또는 관리자가 검수 결과와 근거를 기록. 요청 후 작업이 수정됐으면 다시 요청해야 한다.",
    {
      id,
      revision: z.number().int().positive(),
      status: z.enum(["approved", "rejected"]),
      note: z.string().min(1).max(2000),
    },
  );
  write(
    "save_milestone",
    "milestones",
    "마일스톤 생성·수정. 프로젝트·목표일·같은 프로젝트의 태스크 지정. 수정은 revision 필요.",
    milestoneInput.shape,
  );
  write(
    "save_release",
    "releases",
    "릴리스 계획 또는 실제 배포 기록. 실제 배포는 현재 태스크 버전의 기획 승인·완료·실제 배포일 필요. GitHub 배포를 실행하지 않는다.",
    releaseInput.shape,
  );
  for (const [name, operation] of [
    ["delete_milestone", "milestones/delete"],
    ["delete_release_plan", "releases/delete"],
  ])
    write(
      name!,
      operation!,
      "계획 항목 삭제. 실제 배포 기록과 참조 중인 마일스톤은 삭제할 수 없다.",
      { id, revision: z.number().int().positive() },
    );
  write(
    "update_change_review",
    "changes/update",
    "변경 영향 검토 담당자·메모·결과 기록. applied는 명시한 내부 태스크 필드만 반영하며 최신 targetRevision 필요. GitHub 원문은 변경하지 않는다.",
    {
      id: z.string().uuid(),
      revision: z.number().int().positive(),
      target: id,
      kind: z.enum(["task", "requirement"]),
      reviewerId: z.string().uuid().optional(),
      status: z.enum(["pending", "reviewed", "applied"]).optional(),
      note: z.string().max(2000).optional(),
      targetRevision: z.number().int().positive().optional(),
      targetRecordRevision: z.number().int().positive(),
      patch: z
        .strictObject({
          title: z.string().min(1).max(300).optional(),
          description: z.string().max(8000).optional(),
        })
        .optional(),
    },
  );
  write(
    "apply_schedule_change",
    "schedule/apply",
    "미리보기의 previewHash와 사용자가 선택한 변경만 원자적으로 반영. 버전 변경 시 미리보기를 다시 조회한다.",
    {
      ...scheduleInput.shape,
      previewHash: z.string().length(64),
      selected: z.array(id).min(1).max(500),
    },
  );
  write(
    "save_notification_settings",
    "notification-settings",
    "개인 업무 알림·일일·주간 요약 설정. 최초 revision은 0.",
    {
      revision: z.number().int().min(0),
      due: z.boolean(),
      daily: z.boolean(),
      weekly: z.boolean(),
      assignments: z.boolean(),
    },
  );
  server.registerTool(
    "restore_deleted_batch",
    {
      description:
        "사용자가 요청한 삭제 묶음 전체 복구. 현재 권한·참조·버전을 검증하고 실패 시 모두 롤백.",
      inputSchema: { id: z.string().uuid() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input) => output(await service.restoreTrash(input)),
  );
}
