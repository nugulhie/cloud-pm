import type { Store } from "../db/store";
import { tokenHash } from "../users/crypto";
import { DomainError } from "../core/model";
export function mcpOrigin() {
  const url = new URL(process.env.APP_URL ?? "http://127.0.0.1:3000");
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new DomainError("MCP 인증에는 HTTPS APP_URL이 필요합니다.", 503);
  return url.origin;
}
export const mcpResource = () => mcpOrigin() + "/api/mcp";
export async function resolveOAuthAccess(store: Store, token: string) {
  const row = (
    await store.query<{
      id: string;
      user_id: string;
      workspace_id: string;
      role: "read" | "write";
    }>(
      "SELECT g.id,g.user_id,g.workspace_id,g.role FROM mcp_oauth_tokens t JOIN mcp_oauth_grants g ON g.id=t.grant_id WHERE t.access_hash=$1 AND t.expires_at>now() AND g.revoked_at IS NULL AND g.resource=$2",
      [tokenHash(token), mcpResource()],
    )
  )[0];
  if (!row)
    throw new DomainError("MCP 인증이 만료되었거나 철회되었습니다.", 401);
  await store.query(
    "UPDATE mcp_oauth_grants SET last_used_at=now() WHERE id=$1",
    [row.id],
  );
  return row;
}
