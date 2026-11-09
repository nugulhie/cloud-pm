import { oauthMetadata } from "../../../mcp/oauth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return oauthMetadata((await context.params).path.join("/"));
}
