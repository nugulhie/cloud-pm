import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import type { Store } from "../db/store";
import { Users } from "../users/service";
import { Workspaces } from "../workspaces/service";
import { tokenHash } from "../users/crypto";
import { assertOrigin } from "../core/auth";
import { DomainError } from "../core/model";
import { mcpOrigin, mcpResource } from "./oauth-access";
type Client = {
  id: string;
  name: string;
  redirect_uris: string[];
  secret_hash: string | null;
};
type Pending = {
  id: string;
  client_id: string;
  redirect_uri: string;
  challenge: string;
  scopes: string;
  state: string | null;
  resource: string;
  browser_hash: string;
  expires_at: string;
  used_at: string | null;
};
class OAuthError extends Error {
  constructor(
    public code: string,
    message = "OAuth request rejected",
  ) {
    super(message);
  }
}
const nonce = () => randomBytes(32).toString("base64url");
const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const scopes = (scope: string) => {
  const items = [...new Set(scope.trim().split(/\s+/).filter(Boolean))];
  if (items.some((s) => !["cloud-pm:read", "cloud-pm:write"].includes(s)))
    throw new OAuthError("invalid_scope");
  return items.includes("cloud-pm:write")
    ? "cloud-pm:read cloud-pm:write"
    : "cloud-pm:read";
};
const validRedirect = (value: string) => {
  try {
    const url = new URL(value);
    return (
      !url.hash &&
      !url.username &&
      !url.password &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    );
  } catch {
    return false;
  }
};
function response(data: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "Access-Control-Allow-Origin": "*",
      ...headers,
    },
  });
}
function browserCookie(id: string, value: string, clear = false) {
  return `pm_mcp_${id}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 600}${mcpOrigin().startsWith("https:") ? "; Secure" : ""}`;
}
function cookie(request: Request, id: string) {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`pm_mcp_${id}=`))
      ?.split("=")[1] ?? ""
  );
}
export function oauthMetadata(path: string) {
  const origin = mcpOrigin();
  if (
    ["oauth-protected-resource", "oauth-protected-resource/api/mcp"].includes(
      path,
    )
  )
    return response({
      resource: mcpResource(),
      authorization_servers: [origin],
      scopes_supported: ["cloud-pm:read", "cloud-pm:write"],
      bearer_methods_supported: ["header"],
      resource_name: "솔닥 Cloud PM",
    });
  if (path === "oauth-authorization-server")
    return response({
      issuer: origin,
      authorization_endpoint: origin + "/oauth/authorize",
      token_endpoint: origin + "/oauth/token",
      registration_endpoint: origin + "/oauth/register",
      revocation_endpoint: origin + "/oauth/revoke",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      revocation_endpoint_auth_methods_supported: [
        "none",
        "client_secret_post",
      ],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["cloud-pm:read", "cloud-pm:write"],
      authorization_response_iss_parameter_supported: true,
    });
  return response({ error: "not_found" }, 404);
}
export class McpOAuth {
  constructor(private store: Store) {}
  private async client(id: string) {
    const row = (
      await this.store.query<Client>(
        "SELECT * FROM mcp_oauth_clients WHERE id=$1",
        [id],
      )
    )[0];
    if (!row) throw new OAuthError("invalid_client");
    return row;
  }
  private async throttle(key: string, limit: number) {
    const row = (
      await this.store.query<{ attempts: number }>(
        "INSERT INTO login_attempts(login,attempts) VALUES($1,1) ON CONFLICT(login) DO UPDATE SET attempts=CASE WHEN login_attempts.window_at<now()-interval '15 minutes' THEN 1 ELSE login_attempts.attempts+1 END,window_at=CASE WHEN login_attempts.window_at<now()-interval '15 minutes' THEN now() ELSE login_attempts.window_at END RETURNING attempts",
        [key],
      )
    )[0];
    if (row!.attempts > limit)
      throw new DomainError(
        "인증 요청이 많습니다. 잠시 후 다시 시도하세요.",
        429,
      );
  }
  private async pending(request: Request, id: string, lock = false) {
    const row = (
      await this.store.query<Pending>(
        `SELECT * FROM mcp_oauth_requests WHERE id=$1 AND used_at IS NULL AND expires_at>now()${lock ? " FOR UPDATE" : ""}`,
        [id],
      )
    )[0];
    if (!row || !safeEqual(tokenHash(cookie(request, id)), row.browser_hash))
      throw new OAuthError("invalid_request", "Authorization request expired");
    return row;
  }
  private async browserUser(request: Request) {
    assertOrigin(request);
    if (request.headers.has("authorization"))
      throw new DomainError("브라우저 로그인으로 연결을 승인하세요.", 403);
    const user = (await new Users(this.store).resolve(request, false, false))
      .user;
    if (!user) throw new DomainError("로그인이 필요합니다.", 401);
    return user;
  }
  async register(input: unknown) {
    await this.throttle("mcp:registration", 60);
    const data = z
        .object({
          client_name: z.string().max(200).default("MCP 클라이언트"),
          redirect_uris: z
            .array(z.string().max(2000).refine(validRedirect))
            .min(1)
            .max(10),
          token_endpoint_auth_method: z
            .enum(["none", "client_secret_post"])
            .default("none"),
          grant_types: z
            .array(z.enum(["authorization_code", "refresh_token"]))
            .optional(),
          response_types: z.array(z.literal("code")).optional(),
        })
        .parse(input),
      id = "clpm_" + nonce(),
      secret =
        data.token_endpoint_auth_method === "client_secret_post"
          ? nonce()
          : null;
    await this.store.query(
      "INSERT INTO mcp_oauth_clients(id,name,redirect_uris,secret_hash) VALUES($1,$2,$3::jsonb,$4)",
      [
        id,
        data.client_name,
        JSON.stringify([...new Set(data.redirect_uris)]),
        secret ? tokenHash(secret) : null,
      ],
    );
    return response(
      {
        client_id: id,
        client_name: data.client_name,
        redirect_uris: data.redirect_uris,
        token_endpoint_auth_method: data.token_endpoint_auth_method,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        ...(secret
          ? { client_secret: secret, client_secret_expires_at: 0 }
          : {}),
      },
      201,
    );
  }
  async authorize(request: Request) {
    await this.throttle("mcp:authorize", 240);
    const query = new URL(request.url).searchParams;
    for (const key of [
      "client_id",
      "redirect_uri",
      "response_type",
      "code_challenge",
      "code_challenge_method",
      "resource",
      "state",
      "scope",
    ])
      if (query.getAll(key).length > 1) throw new OAuthError("invalid_request");
    const client = await this.client(query.get("client_id") ?? ""),
      redirect = query.get("redirect_uri") ?? "";
    if (
      !client.redirect_uris.includes(redirect) ||
      query.get("response_type") !== "code" ||
      query.get("code_challenge_method") !== "S256" ||
      !/^[-_A-Za-z0-9]{43}$/.test(query.get("code_challenge") ?? "") ||
      query.get("resource") !== mcpResource() ||
      (query.get("state")?.length ?? 0) > 1000
    )
      throw new OAuthError("invalid_request");
    const id = randomUUID(),
      browser = nonce();
    await this.store.query(
      "INSERT INTO mcp_oauth_requests(id,client_id,redirect_uri,challenge,scopes,state,resource,browser_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '10 minutes')",
      [
        id,
        client.id,
        redirect,
        query.get("code_challenge"),
        scopes(query.get("scope") ?? ""),
        query.get("state"),
        mcpResource(),
        tokenHash(browser),
      ],
    );
    return new Response(null, {
      status: 302,
      headers: {
        Location: mcpOrigin() + "/mcp/consent?request=" + id,
        "Set-Cookie": browserCookie(id, browser),
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  async consentInfo(request: Request) {
    const id = z
        .string()
        .uuid()
        .parse(new URL(request.url).searchParams.get("request")),
      pending = await this.pending(request, id),
      user = await this.browserUser(request),
      client = await this.client(pending.client_id);
    return response({
      request: id,
      csrf: cookie(request, id),
      user: { id: user.id, name: user.displayName },
      client: {
        name: client.name,
        redirectOrigin: new URL(pending.redirect_uri).origin,
      },
      write: pending.scopes.includes("cloud-pm:write"),
      workspaces: await new Workspaces(this.store, user.id).list(),
    });
  }
  async consent(request: Request, input: unknown) {
    const value = z
        .strictObject({
          request: z.string().uuid(),
          csrf: z.string().min(40).max(100),
          expectedUserId: z.string().uuid(),
          workspaceId: z.string().max(100),
          decision: z.enum(["allow", "deny"]),
          role: z.enum(["read", "write"]),
        })
        .parse(input),
      user = await this.browserUser(request);
    if (user.id !== value.expectedUserId)
      throw new DomainError(
        "로그인 계정이 변경되었습니다. 연결을 다시 확인하세요.",
        409,
      );
    const result = await this.store.transaction(async (store) => {
      const flow = new McpOAuth(store),
        pending = await flow.pending(request, value.request, true);
      if (!safeEqual(value.csrf, cookie(request, value.request)))
        throw new DomainError("인증 요청을 다시 시작하세요.", 403);
      const target = new URL(pending.redirect_uri);
      target.searchParams.set("iss", mcpOrigin());
      if (pending.state !== null)
        target.searchParams.set("state", pending.state);
      if (value.decision === "deny")
        target.searchParams.set("error", "access_denied");
      else {
        const workspace = await new Workspaces(store, user.id).get(
          value.workspaceId,
        );
        if (
          value.role === "write" &&
          (workspace.role === "viewer" ||
            !pending.scopes.includes("cloud-pm:write"))
        )
          throw new DomainError("쓰기 권한을 부여할 수 없습니다.", 403);
        const grantId = randomUUID(),
          code = nonce();
        await store.query(
          "INSERT INTO mcp_oauth_grants(id,client_id,user_id,workspace_id,role,resource) VALUES($1,$2,$3,$4,$5,$6)",
          [
            grantId,
            pending.client_id,
            user.id,
            workspace.id,
            value.role,
            mcpResource(),
          ],
        );
        await store.query(
          "INSERT INTO mcp_oauth_codes(hash,grant_id,redirect_uri,challenge,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes')",
          [tokenHash(code), grantId, pending.redirect_uri, pending.challenge],
        );
        target.searchParams.set("code", code);
      }
      await store.query(
        "UPDATE mcp_oauth_requests SET used_at=now() WHERE id=$1",
        [value.request],
      );
      return target.href;
    });
    return response({ redirect: result }, 200, {
      "Set-Cookie": browserCookie(value.request, "", true),
    });
  }
  private async authenticateClient(body: Record<string, string>) {
    const client = await this.client(body.client_id ?? "");
    if (
      client.secret_hash &&
      !safeEqual(client.secret_hash, tokenHash(body.client_secret ?? ""))
    )
      throw new OAuthError("invalid_client");
    return client;
  }
  private async mint(grant: string, role: string, store: Store) {
    const access = "cmo_" + nonce(),
      refresh = "cmr_" + nonce();
    await store.query(
      "INSERT INTO mcp_oauth_tokens(access_hash,refresh_hash,grant_id,expires_at,refresh_expires_at) VALUES($1,$2,$3,now()+interval '15 minutes',now()+interval '30 days')",
      [tokenHash(access), tokenHash(refresh), grant],
    );
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: "Bearer",
      expires_in: 900,
      scope:
        role === "write" ? "cloud-pm:read cloud-pm:write" : "cloud-pm:read",
    };
  }
  async token(body: Record<string, string>) {
    await this.throttle("mcp:token", 1200);
    const client = await this.authenticateClient(body);
    if (body.resource !== mcpResource()) throw new OAuthError("invalid_target");
    const result = await this.store.transaction(async (store) => {
      if (body.grant_type === "authorization_code") {
        const code = (
          await store.query<{
            grant_id: string;
            redirect_uri: string;
            challenge: string;
            used_at: string | null;
            valid: boolean;
            client_id: string;
            role: string;
            revoked_at: string | null;
            resource: string;
          }>(
            "SELECT c.*,c.expires_at>now() AS valid,g.client_id,g.role,g.resource,g.revoked_at FROM mcp_oauth_codes c JOIN mcp_oauth_grants g ON g.id=c.grant_id WHERE c.hash=$1 FOR UPDATE OF c",
            [tokenHash(body.code ?? "")],
          )
        )[0];
        if (
          !code ||
          code.client_id !== client.id ||
          code.redirect_uri !== body.redirect_uri ||
          code.resource !== body.resource ||
          code.revoked_at ||
          !code.valid ||
          !/^[-._~A-Za-z0-9]{43,128}$/.test(body.code_verifier ?? "") ||
          !safeEqual(
            createHash("sha256")
              .update(body.code_verifier ?? "")
              .digest("base64url"),
            code.challenge,
          )
        )
          return { error: "invalid_grant" };
        if (code.used_at) {
          await store.query(
            "UPDATE mcp_oauth_grants SET revoked_at=now() WHERE id=$1",
            [code.grant_id],
          );
          return { error: "invalid_grant" };
        }
        await store.query(
          "UPDATE mcp_oauth_codes SET used_at=now() WHERE hash=$1",
          [tokenHash(body.code ?? "")],
        );
        return this.mint(code.grant_id, code.role, store);
      }
      if (body.grant_type === "refresh_token") {
        const token = (
          await store.query<{
            grant_id: string;
            refresh_used_at: string | null;
            valid: boolean;
            client_id: string;
            role: string;
            revoked_at: string | null;
            resource: string;
          }>(
            "SELECT t.*,t.refresh_expires_at>now() AS valid,g.client_id,g.role,g.resource,g.revoked_at FROM mcp_oauth_tokens t JOIN mcp_oauth_grants g ON g.id=t.grant_id WHERE t.refresh_hash=$1 FOR UPDATE OF t",
            [tokenHash(body.refresh_token ?? "")],
          )
        )[0];
        if (
          !token ||
          token.client_id !== client.id ||
          token.resource !== body.resource ||
          token.revoked_at ||
          !token.valid
        )
          return { error: "invalid_grant" };
        if (token.refresh_used_at) {
          await store.query(
            "UPDATE mcp_oauth_grants SET revoked_at=now() WHERE id=$1",
            [token.grant_id],
          );
          return { error: "invalid_grant" };
        }
        const requested = body.scope ? scopes(body.scope) : null;
        if (requested?.includes("cloud-pm:write") && token.role !== "write")
          return { error: "invalid_scope" };
        await store.query(
          "UPDATE mcp_oauth_tokens SET refresh_used_at=now() WHERE refresh_hash=$1",
          [tokenHash(body.refresh_token ?? "")],
        );
        // 축소한 권한을 이후 갱신에도 유지한다.
        const role =
          requested && !requested.includes("cloud-pm:write")
            ? "read"
            : token.role;
        if (role !== token.role)
          await store.query("UPDATE mcp_oauth_grants SET role=$2 WHERE id=$1", [
            token.grant_id,
            role,
          ]);
        return this.mint(token.grant_id, role, store);
      }
      return { error: "unsupported_grant_type" };
    });
    return response(result, "error" in result ? 400 : 200);
  }
  async revoke(body: Record<string, string>) {
    const client = await this.authenticateClient(body);
    await this.store.query(
      "UPDATE mcp_oauth_grants SET revoked_at=now() WHERE client_id=$1 AND id IN (SELECT grant_id FROM mcp_oauth_tokens WHERE access_hash=$2 OR refresh_hash=$2)",
      [client.id, tokenHash(body.token ?? "")],
    );
    return response({});
  }
  async connections(request: Request) {
    const user = await this.browserUser(request);
    const items = await this.store.query(
      "SELECT g.id,c.name AS client,g.workspace_id,g.role,g.created_at,g.last_used_at FROM mcp_oauth_grants g JOIN mcp_oauth_clients c ON c.id=g.client_id WHERE g.user_id=$1 AND g.revoked_at IS NULL ORDER BY g.created_at DESC",
      [user.id],
    );
    return response({ items });
  }
  async disconnect(request: Request, input: unknown) {
    const user = await this.browserUser(request),
      value = z.strictObject({ id: z.string().uuid() }).parse(input);
    await this.store.query(
      "UPDATE mcp_oauth_grants SET revoked_at=now() WHERE id=$1 AND user_id=$2",
      [value.id, user.id],
    );
    return response({ revoked: true });
  }
}
export async function handleOAuth(
  store: Store,
  request: Request,
  action: string,
) {
  try {
    const flow = new McpOAuth(store);
    if (request.method === "GET" && action === "authorize")
      return await flow.authorize(request);
    if (request.method === "GET" && action === "consent")
      return await flow.consentInfo(request);
    if (request.method === "GET" && action === "connections")
      return await flow.connections(request);
    if (request.method !== "POST")
      return response({ error: "invalid_request" }, 405);
    const text = await request.text();
    if (Buffer.byteLength(text) > 12000)
      throw new DomainError("요청이 너무 큽니다.", 413);
    if (action === "register") return await flow.register(JSON.parse(text));
    if (action === "consent")
      return await flow.consent(request, JSON.parse(text));
    if (action === "disconnect")
      return await flow.disconnect(request, JSON.parse(text));
    const pairs = new URLSearchParams(text);
    for (const key of pairs.keys())
      if (pairs.getAll(key).length > 1) throw new OAuthError("invalid_request");
    const body = Object.fromEntries(pairs);
    if (action === "token") return await flow.token(body);
    if (action === "revoke") return await flow.revoke(body);
    return response({ error: "not_found" }, 404);
  } catch (error) {
    return response(
      {
        error: error instanceof OAuthError ? error.code : "invalid_request",
        error_description:
          error instanceof DomainError
            ? error.message
            : "인증 요청을 확인하고 다시 시도하세요.",
      },
      error instanceof DomainError ? error.status : 400,
    );
  }
}
