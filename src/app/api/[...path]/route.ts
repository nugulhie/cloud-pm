import { GitHubRateLimitError } from "../../../github/rate-limit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { serviceFor } from "../../../core/runtime";
import { DomainError } from "../../../core/model";
import { ASANA_MAX_REQUEST_BYTES } from "../../../core/asana-limits";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return handle(request, await context.params);
}
export async function POST(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return handle(request, await context.params);
}
async function handle(request: Request, { path }: { path: string[] }) {
  try {
    const service = await serviceFor(request);
    const route = path.join("/");
    if (request.method === "GET") {
      if (route.startsWith("planning/"))
        return NextResponse.json(
          await service.readPlanning(
            route.slice(9),
            Object.fromEntries(new URL(request.url).searchParams),
          ),
          { headers: { "Cache-Control": "no-store" } },
        );
      if (route === "knowledge/impact")
        return NextResponse.json(
          await service.getKnowledgeImpact(
            Object.fromEntries(new URL(request.url).searchParams),
          ),
          { headers: { "Cache-Control": "no-store" } },
        );
      if (route === "github/assignees") {
        const query = new URL(request.url).searchParams;
        return NextResponse.json(
          await service.listGitHubAssignees({
            project: query.get("project"),
            ...(query.get("repository")
              ? { repository: query.get("repository") }
              : {}),
          }),
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      if (route === "github/item")
        return NextResponse.json(
          await service.githubItem(
            z.string().parse(new URL(request.url).searchParams.get("id")),
          ),
        );
      if (route === "tasks/dependencies")
        return NextResponse.json(
          await service.taskDependencies(
            z.string().parse(new URL(request.url).searchParams.get("task")),
          ),
        );
      if (route === "comments")
        return NextResponse.json(
          await service.listComments(
            z.string().parse(new URL(request.url).searchParams.get("task")),
          ),
        );
      if (route === "notifications")
        return NextResponse.json(await service.listNotifications());
      if (route === "dashboard")
        return NextResponse.json(await service.dashboard());
      if (route === "jobs")
        return NextResponse.json(await service.listSyncJobs());
      if (route === "history")
        return NextResponse.json(await service.history());
    }
    if (request.method === "POST") {
      const text = await request.text();
      if (
        Buffer.byteLength(text) >
        (route.startsWith("projects/import/asana") ||
        route.startsWith("tasks/import/asana")
          ? ASANA_MAX_REQUEST_BYTES
          : route.startsWith("requirements/import")
            ? 2200000
            : 100000)
      )
        throw new DomainError("요청이 너무 큽니다.", 413);
      const body = text ? JSON.parse(text) : {};
      if (route === "github/issue-assignees")
        return NextResponse.json(await service.updateIssueAssignees(body));
      if (route === "planning/tasks/query")
        return NextResponse.json(
          await service.readPlanning("tasks/query", body),
          { headers: { "Cache-Control": "no-store" } },
        );
      if (route.startsWith("planning/"))
        return NextResponse.json(
          await service.writePlanning(route.slice(9), body),
        );
      if (route === "projects/import/asana/preview")
        return NextResponse.json(await service.previewAsanaProject(body));
      if (route === "projects/import/asana")
        return NextResponse.json(await service.importAsanaProject(body));
      if (route === "tasks/import/asana/preview")
        return NextResponse.json(await service.previewAsanaFile(body));
      if (route === "tasks/import/asana")
        return NextResponse.json(await service.importAsanaFile(body));
      if (route === "work-items/migrate")
        return NextResponse.json(await service.migrateWorkItems());
      if (route === "requirements/import/preview")
        return NextResponse.json(await service.previewRequirementCsv(body));
      if (route === "requirements/import")
        return NextResponse.json(await service.importRequirementCsv(body));
      if (route === "knowledge")
        return NextResponse.json(
          await service.saveKnowledge(
            body.data,
            z.number().int().positive().optional().parse(body.revision),
          ),
        );
      if (route === "knowledge/delete")
        return NextResponse.json(await service.deleteKnowledge(body));
      if (route === "requirements")
        return NextResponse.json(
          await service.saveRequirement(
            body.data,
            z.number().int().positive().optional().parse(body.revision),
          ),
        );
      if (route === "requirements/delete")
        return NextResponse.json(
          await service.deleteRequirements(body.entries),
        );
      if (route === "requirements/convert")
        return NextResponse.json(await service.convertRequirements(body));
      if (route === "requirements/issue-preview")
        return NextResponse.json(await service.previewRequirementIssue(body));
      if (route === "requirements/issue")
        return NextResponse.json(await service.publishRequirementIssue(body));
      if (route === "comments")
        return NextResponse.json(await service.saveComment(body));
      if (route === "comments/delete")
        return NextResponse.json(await service.deleteComment(body));
      if (route === "notifications/read")
        return NextResponse.json(await service.readNotification(body));
      if (route === "manage/update")
        return NextResponse.json(await service.bulkUpdate(body));
      if (route === "manage/delete")
        return NextResponse.json(await service.removeEntities(body));
      if (route === "items/import")
        return NextResponse.json(await service.importItems(body));
      if (route === "analysis")
        return NextResponse.json(
          await service.analyzeProject(z.string().parse(body.project)),
        );
      if (route === "links/ai-suggest")
        return NextResponse.json(
          await service.aiSuggestLinks(z.string().parse(body.task)),
        );
      if (route === "links/manual")
        return NextResponse.json(
          await service.linkTask(
            z.string().parse(body.task),
            z.string().parse(body.item),
          ),
        );
      if (route === "jobs/retry")
        return NextResponse.json(
          await service.retrySyncJob(z.string().uuid().parse(body.id)),
        );
      if (route === "sync")
        return NextResponse.json(
          await service.sync(
            z.object({ project: z.string().optional() }).parse(body),
          ),
        );
      const revision = z
        .number()
        .int()
        .positive()
        .optional()
        .parse(body.revision);
      if (route === "projects")
        return NextResponse.json(
          await service.saveProject(body.data, revision),
        );
      if (route === "features")
        return NextResponse.json(
          await service.saveFeature(body.data, revision),
        );
      if (route === "tasks")
        return NextResponse.json(await service.saveTask(body.data, revision));
      if (route === "links/suggest")
        return NextResponse.json(
          await service.suggestLinks(z.string().parse(body.task)),
        );
      if (route === "links/decide")
        return NextResponse.json(
          await service.decideLink(
            z.string().parse(body.id),
            z.enum(["approved", "rejected"]).parse(body.status),
            z.number().int().positive().parse(revision),
          ),
        );
    }
    return NextResponse.json(
      { error: "경로를 찾을 수 없습니다." },
      { status: 404 },
    );
  } catch (error) {
    const status =
      error instanceof DomainError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 500;
    return NextResponse.json(
      {
        error:
          error instanceof DomainError
            ? error.message
            : status === 400
              ? "입력 형식을 확인하세요."
              : "처리 중 오류가 발생했습니다.",
      },
      {
        status,
        ...(error instanceof GitHubRateLimitError
          ? {
              headers: {
                "Retry-After": String(
                  Math.max(1, Math.ceil((error.retryAt - Date.now()) / 1000)),
                ),
              },
            }
          : {}),
      },
    );
  }
}
