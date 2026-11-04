import { isIP } from "node:net";
import { Store } from "../db/store";
import type { Actor } from "../core/model";
import { tokenHash } from "../users/crypto";

export function connectionAddress(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error();
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const octets = host.split(".").map(Number);
    const local =
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host === "::1" ||
      host === "::" ||
      (isIP(host) === 6 && /^(fc|fd|fe80:)/.test(host)) ||
      (isIP(host) === 4 &&
        (octets[0] === 0 ||
          octets[0] === 10 ||
          octets[0] === 127 ||
          (octets[0] === 169 && octets[1] === 254) ||
          (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
          (octets[0] === 192 && octets[1] === 168)));
    return {
      url: `${url.origin}/api/mcp`,
      publicHttps: url.protocol === "https:" && !local,
      configured: true,
    };
  } catch {
    return { url: null, publicHttps: false, configured: false };
  }
}
export async function recordMcpConnection(
  store: Store,
  actor: Actor,
  authorization: string | null,
  body: unknown,
) {
  if (!actor.userId || !authorization?.startsWith("Bearer ")) return;
  const rpc = body as {
    method?: unknown;
    params?: { clientInfo?: { name?: unknown }; protocolVersion?: unknown };
  };
  if (
    !["initialize", "tools/list", "tools/call", "ping"].includes(
      String(rpc?.method),
    )
  )
    return;
  const name =
    typeof rpc?.params?.clientInfo?.name === "string"
      ? rpc.params.clientInfo.name.slice(0, 200)
      : null;
  const protocol =
    typeof rpc?.params?.protocolVersion === "string"
      ? rpc.params.protocolVersion.slice(0, 30)
      : null;
  await store.query(
    `INSERT INTO mcp_connections(workspace_id,user_id,token_hash,last_seen,client_name,method,protocol_version) VALUES($1,$2,$3,now(),$4,$5,$6) ON CONFLICT(workspace_id,user_id) DO UPDATE SET token_hash=excluded.token_hash,last_seen=now(),client_name=CASE WHEN mcp_connections.token_hash=excluded.token_hash THEN COALESCE(excluded.client_name,mcp_connections.client_name) ELSE excluded.client_name END,method=excluded.method,protocol_version=COALESCE(excluded.protocol_version,mcp_connections.protocol_version)`,
    [
      actor.workspaceId ?? store.workspaceId,
      actor.userId,
      tokenHash(authorization.slice(7)),
      name,
      String(rpc.method),
      protocol,
    ],
  );
}
export const MCP_BODY_LIMIT = 100000;
export async function readMcpBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MCP_BODY_LIMIT) {
        await reader.cancel();
        throw new McpBodyError("MCP 요청이 너무 큽니다.", 413);
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch {
      throw new McpBodyError("올바른 JSON 요청이 필요합니다.", 400);
    }
  } finally {
    reader.releaseLock();
  }
}
export class McpBodyError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
