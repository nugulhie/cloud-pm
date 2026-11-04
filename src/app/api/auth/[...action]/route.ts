import { z } from "zod";
import { getStore } from "../../../../db/store";
import { Users } from "../../../../users/service";
import { DomainError } from "../../../../core/model";
import { assertOrigin } from "../../../../core/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cookie = (value: string, request: Request, clear = false) =>
  `pm_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${clear ? 0 : 604800}${new URL(process.env.APP_URL ?? request.url).protocol === "https:" ? "; Secure" : ""}`;
export async function GET(
  request: Request,
  { params }: { params: Promise<{ action: string[] }> },
) {
  return handle(request, (await params).action.join("/"));
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string[] }> },
) {
  return handle(request, (await params).action.join("/"));
}
async function handle(request: Request, action: string) {
  try {
    assertOrigin(request);
    const users = new Users(getStore());
    if (request.method === "GET" && action === "mcp/status")
      return Response.json(await users.mcpStatus(request), {
        headers: { "Cache-Control": "no-store" },
      });
    if (request.method === "GET" && action === "workspaces")
      return Response.json(await users.listWorkspaces(request));
    if (request.method === "GET" && action === "workspace")
      return Response.json(await users.workspace(request));
    if (request.method === "GET" && action === "me") {
      const resolved = await users.resolve(request, false);
      return Response.json({
        user: resolved.user,
        mode: resolved.user ? "user" : "legacy",
        effectiveRole: resolved.actor.role,
        workspaceRole: resolved.actor.workspaceRole ?? null,
      });
    }
    if (request.method !== "POST")
      return Response.json(
        { error: "경로를 찾을 수 없습니다." },
        { status: 404 },
      );
    const text = await request.text();
    if (Buffer.byteLength(text) > 12000)
      throw new DomainError("요청이 너무 큽니다.", 413);
    const body = text ? JSON.parse(text) : {};
    if (action === "register" || action === "login") {
      const result =
        action === "register"
          ? await users.register(body)
          : await users.login(body);
      return Response.json(
        { user: result.user, workspaceId: result.workspaceId },
        { headers: { "Set-Cookie": cookie(result.token, request) } },
      );
    }
    if (action === "workspaces")
      return Response.json(await users.createWorkspace(request, body));
    if (action === "workspaces/switch")
      return Response.json(await users.switchWorkspace(request, body));
    if (action === "invites/accept")
      return Response.json(await users.acceptInvite(request, body));
    if (action === "members/role")
      return Response.json(await users.updateMember(request, body));
    if (action === "members/remove")
      return Response.json(await users.removeMember(request, body));
    if (action === "workspace")
      return Response.json(await users.updateWorkspace(request, body));
    if (action === "workspace/github")
      return Response.json(await users.updateWorkspaceGithub(request, body));
    if (action === "invites")
      return Response.json(await users.createInvite(request, body));
    if (action === "invites/revoke")
      return Response.json(await users.revokeInvite(request, body));
    if (action === "logout") {
      await users.logout(request);
      return Response.json(
        { ok: true },
        { headers: { "Set-Cookie": cookie("", request, true) } },
      );
    }
    if (action === "profile")
      return Response.json({ user: await users.update(request, body) });
    if (action === "service-token")
      return Response.json(
        await users.rotateApiToken(
          request,
          z.enum(["read", "write"]).parse(body.role),
        ),
      );
    if (action === "revoke-service-token") {
      await users.revokeApiToken(request);
      return Response.json({ revoked: true });
    }
    if (action === "password")
      return Response.json(await users.changePassword(request, body));
    return Response.json(
      { error: "경로를 찾을 수 없습니다." },
      { status: 404 },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof DomainError
            ? error.message
            : error instanceof z.ZodError
              ? "입력 형식을 확인하세요. 비밀번호는 10자 이상이어야 합니다."
              : "계정 요청을 처리하지 못했습니다.",
      },
      {
        status:
          error instanceof DomainError
            ? error.status
            : error instanceof z.ZodError || error instanceof SyntaxError
              ? 400
              : 500,
      },
    );
  }
}
