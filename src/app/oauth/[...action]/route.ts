import { getStore } from "../../../db/store";
import { handleOAuth } from "../../../mcp/oauth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ action: string[] }> },
) {
  return handleOAuth(
    getStore(),
    request,
    (await context.params).action.join("/"),
  );
}
export const POST = GET;
export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Cache-Control": "no-store",
    },
  });
}
