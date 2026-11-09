import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { serviceFor } from "../../../core/runtime";
import { createMcpServer } from "../../../mcp/server";
import { DomainError } from "../../../core/model";
import { mcpOrigin } from "../../../mcp/oauth-access";
import {
  McpBodyError,
  readMcpBody,
  recordMcpConnection,
} from "../../../mcp/connection";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function authenticationChallenge() {
  try {
    return `Bearer realm="cloud-pm-agent", resource_metadata="${mcpOrigin()}/.well-known/oauth-protected-resource/api/mcp"`;
  } catch {
    return 'Bearer realm="cloud-pm-agent"';
  }
}
export async function POST(request: Request) {
  try {
    const service = await serviceFor(request);
    const body = await readMcpBody(request);
    const server = createMcpServer(service);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      const response = await transport.handleRequest(request, {
        parsedBody: body,
      });
      if (response.ok) {
        // 접속 기록 실패가 정상 도구 호출 결과를 바꾸지 않도록 한다.
        await recordMcpConnection(
          service.store,
          service.actor,
          request.headers.get("authorization"),
          body,
        ).catch(() => {});
      }
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Access-Control-Allow-Origin", "*");
      return response;
    } finally {
      await transport.close();
      await server.close();
    }
  } catch (error) {
    const status =
      error instanceof DomainError || error instanceof McpBodyError
        ? error.status
        : 500;
    return Response.json(
      {
        error:
          error instanceof DomainError || error instanceof McpBodyError
            ? error.message
            : "MCP 요청을 처리할 수 없습니다.",
      },
      {
        status,
        headers: {
          "Cache-Control": "no-store",
          ...(status === 401
            ? {
                "WWW-Authenticate": authenticationChallenge(),
              }
            : {}),
        },
      },
    );
  }
}
export async function GET() {
  return new Response(null, {
    status: 405,
    headers: { Allow: "POST", "Cache-Control": "no-store" },
  });
}
export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST,GET,DELETE,OPTIONS",
      "Access-Control-Allow-Headers":
        "Authorization,Content-Type,MCP-Protocol-Version,MCP-Session-Id,X-Workspace-Id",
      "Access-Control-Expose-Headers": "WWW-Authenticate",
      "Cache-Control": "no-store",
    },
  });
}
export async function DELETE() {
  return new Response(null, {
    status: 405,
    headers: { Allow: "POST", "Cache-Control": "no-store" },
  });
}
