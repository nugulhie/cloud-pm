import { GitHubRateLimitError } from "../github/rate-limit";
import { connectionAddress } from "../mcp/connection";
import { Workspaces } from "../workspaces/service";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { Store } from "../db/store";
import { GitHubClient } from "../github/client";
import {
  appWorkspaceId,
  configuredGitHubApp,
  githubAppConfigured,
} from "../github/app";
import { DomainError, type Actor, type WorkspaceRole } from "../core/model";
import { authenticate, demoMode } from "../core/auth";
import {
  hashPassword,
  checkPassword,
  encryptToken,
  decryptToken,
  tokenHash,
} from "./crypto";

interface User {
  id: string;
  login: string;
  display_name: string;
  password_hash: string;
  github_cipher: string;
  github_login: string | null;
  github_last4: string;
  repositories: string[];
  permissions_at: string;
  role: string;
  api_token_hash: string | null;
  api_last4: string | null;
  api_role: "read" | "write";
  current_workspace?: string;
  api_workspace_id?: string;
}
export const publicUser = (u: User) => ({
  id: u.id,
  login: u.login,
  displayName: u.display_name,
  role: u.role,
  githubTokenLast4: u.github_last4,
  githubLogin: u.github_login,
  githubConnected: !!u.github_cipher,
  serviceTokenLast4: u.api_last4,
  serviceTokenRole: u.api_role,
  serviceTokenWorkspaceId: u.api_workspace_id ?? "main",
  repositoryCount: u.repositories.length,
  permissionsAt: new Date(u.permissions_at).toISOString(),
});
const password = z.string().min(10).max(200);
export class Users {
  constructor(
    private store: Store,
    private fetcher: typeof fetch = fetch,
  ) {}
  private async sharedGithub(workspaceId: string): Promise<{
    token: string;
    repositories: string[];
    tokenProvider?: () => Promise<string>;
  } | null> {
    if (workspaceId === appWorkspaceId()) {
      const app = configuredGitHubApp(this.fetcher);
      if (app) {
        const access = await app.access();
        return { ...access, tokenProvider: app.token };
      }
    }
    const connection = (
      await this.store.query<{
        github_cipher: string;
        github_login: string;
        repositories: string[];
        permissions_at: string;
      }>(
        "SELECT github_cipher,github_login,repositories,permissions_at FROM workspace_github WHERE workspace_id=$1",
        [workspaceId],
      )
    )[0];
    if (!connection) return null;
    const token = decryptToken(connection.github_cipher);
    if (Date.now() - new Date(connection.permissions_at).getTime() > 60000) {
      try {
        const access = await this.verifyGithub(token);
        if (access.login !== connection.github_login)
          throw new Error("연결 계정 불일치");
        await this.store.query(
          "UPDATE workspace_github SET repositories=$2::jsonb,permissions_at=now() WHERE workspace_id=$1",
          [workspaceId, JSON.stringify(access.repositories)],
        );
        connection.repositories = access.repositories;
      } catch {
        await this.store.query(
          "UPDATE workspace_github SET repositories='[]'::jsonb,permissions_at=to_timestamp(0) WHERE workspace_id=$1",
          [workspaceId],
        );
        throw new DomainError(
          "워크스페이스 GitHub 연결을 확인하지 못했습니다. 관리자에게 연결 갱신을 요청하세요.",
          403,
        );
      }
    }
    return { token, repositories: connection.repositories };
  }
  async updateWorkspaceGithub(request: Request, input: unknown) {
    const access = await this.workspaceAdmin(request);
    if (!access.admin)
      throw new DomainError(
        "워크스페이스 관리자만 GitHub 연결을 설정할 수 있습니다.",
        403,
      );
    const data = z
      .strictObject({
        githubToken: z.string().min(1).max(1000).optional(),
        usePersonal: z.boolean().optional(),
        disconnect: z.boolean().optional(),
      })
      .parse(input);
    if (data.disconnect) {
      await this.store.query(
        "DELETE FROM workspace_github WHERE workspace_id=$1",
        [access.workspaceId],
      );
      return this.workspace(request);
    }
    let token = data.githubToken;
    if (data.usePersonal) {
      const user = (
        await this.store.query<{ github_cipher: string }>(
          "SELECT github_cipher FROM app_users WHERE id=$1",
          [access.user.id],
        )
      )[0];
      if (!user?.github_cipher)
        throw new DomainError("공유할 개인 GitHub 연결이 없습니다.");
      token = decryptToken(user.github_cipher);
    }
    if (!token) throw new DomainError("공유할 GitHub 토큰을 입력하세요.");
    const verified = await this.verifyGithub(token);
    await this.store.query(
      "INSERT INTO workspace_github(workspace_id,github_cipher,github_last4,github_login,repositories) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(workspace_id) DO UPDATE SET github_cipher=EXCLUDED.github_cipher,github_last4=EXCLUDED.github_last4,github_login=EXCLUDED.github_login,repositories=EXCLUDED.repositories,permissions_at=now()",
      [
        access.workspaceId,
        encryptToken(token),
        token.slice(-4),
        verified.login,
        JSON.stringify(verified.repositories),
      ],
    );
    return this.workspace(request);
  }
  async verifyGithub(token: string) {
    const org = z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .safeParse(process.env.GITHUB_ORG);
    if (!org.success)
      throw new DomainError("GitHub 조직을 먼저 설정하세요.", 503);
    const client = new GitHubClient({ token, fetch: this.fetcher });
    try {
      const user = z
        .object({ login: z.string(), name: z.string().nullable() })
        .parse(await client.get("/user"));
      const membership = z
        .object({ state: z.literal("active"), role: z.string() })
        .parse(await client.get(`/user/memberships/orgs/${org.data}`));
      const repos = z
        .array(z.object({ full_name: z.string() }))
        .parse(await client.listOrganizationRepositories(org.data));
      return {
        login: user.login.toLowerCase(),
        name: user.name ?? user.login,
        role: membership.role === "admin" ? "admin" : "member",
        repositories: repos.map((r) => r.full_name.toLowerCase()),
      };
    } catch {
      throw new DomainError(
        "GitHub 토큰과 조직 멤버십을 확인하세요. repo·read:org 읽기 권한이 필요합니다.",
        403,
      );
    }
  }
  async register(input: unknown) {
    const data = z
      .strictObject({
        password,
        inviteToken: z.string().min(20).max(200).optional(),
        githubToken: z.string().min(1).max(1000).optional(),
        login: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9-]{3,39}$/)
          .optional(),
        displayName: z.string().trim().min(1).max(100).optional(),
      })
      .parse(input);
    const policy = (
      await this.store.query<{ invite_only: boolean }>(
        "SELECT invite_only FROM workspace_settings WHERE id='main'",
      )
    )[0];
    if (policy?.invite_only && !data.inviteToken)
      throw new DomainError("워크스페이스 초대 링크로 가입하세요.", 403);
    if (!data.githubToken && !data.login)
      throw new DomainError("서비스 아이디를 입력하세요.");
    const verified = data.githubToken
      ? await this.verifyGithub(data.githubToken)
      : {
          login: data.login!.toLowerCase(),
          name: data.displayName ?? data.login!,
          role: "member",
          repositories: [],
        };
    const cipher = data.githubToken ? encryptToken(data.githubToken) : "";
    const hash = await hashPassword(data.password);
    const userId = randomUUID();
    const rows = await this.store.query<User>(
      (data.inviteToken
        ? `WITH invitation AS (UPDATE workspace_invites SET status='accepted' WHERE token_hash=$9 AND status='pending' AND expires_at>now() AND (expected_login IS NULL OR expected_login=$2) AND NOT EXISTS(SELECT 1 FROM app_users WHERE login=$2) RETURNING id) `
        : "") +
        `INSERT INTO app_users(id,login,display_name,password_hash,github_cipher,github_last4,repositories,role) ${data.inviteToken ? "SELECT $1,$2,$3,$4,$5,$6,$7::jsonb,$8 FROM invitation" : "VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)"} ON CONFLICT(login) DO NOTHING RETURNING *`,
      [
        userId,
        verified.login,
        data.displayName ?? verified.name,
        hash,
        cipher,
        data.githubToken?.slice(-4) ?? "",
        JSON.stringify(verified.repositories),
        verified.role,
        ...(data.inviteToken ? [tokenHash(data.inviteToken)] : []),
      ],
    );
    if (!rows[0])
      throw new DomainError(
        data.inviteToken
          ? "초대가 만료·취소되었거나 대상 계정이 다르거나 이미 가입된 계정입니다."
          : "이미 등록된 아이디입니다. 로그인하거나 다른 아이디를 사용하세요.",
        409,
      );
    if (data.githubToken)
      await this.store.query(
        "UPDATE app_users SET github_login=$2 WHERE id=$1",
        [userId, verified.login],
      );
    rows[0]!.github_login = data.githubToken ? verified.login : null;
    if (data.inviteToken)
      await this.store.query(
        "UPDATE workspace_invites SET accepted_by=$2 WHERE token_hash=$1 AND status='accepted'",
        [tokenHash(data.inviteToken), userId],
      );
    if (data.inviteToken) {
      await this.store.query(
        "INSERT INTO workspace_members(workspace_id,user_id,role) SELECT workspace_id,$2,member_role FROM workspace_invites WHERE token_hash=$1 AND accepted_by=$2 ON CONFLICT DO NOTHING",
        [tokenHash(data.inviteToken), userId],
      );
    } else await new Workspaces(this.store, userId).joinDefault();
    return this.newSession(rows[0]);
  }
  private async newSession(user: User) {
    const workspaces = await new Workspaces(this.store, user.id).list();
    const workspaceId = workspaces[0]?.id ?? "main";
    const token = randomBytes(32).toString("base64url");
    await this.store.query(
      `INSERT INTO app_sessions(token_hash,user_id,expires_at,workspace_id) VALUES($1,$2,now()+interval '7 days',$3)`,
      [tokenHash(token), user.id, workspaceId],
    );
    return { token, user: publicUser(user), workspaceId };
  }
  async login(input: unknown) {
    const data = z
      .strictObject({
        login: z.string().trim().min(1).max(100),
        password: z.string().min(1).max(200),
      })
      .parse(input);
    const login = data.login.toLowerCase();
    const attempts = await this.store.query<{ attempts: number }>(
      `INSERT INTO login_attempts(login,attempts) VALUES($1,1) ON CONFLICT(login) DO UPDATE SET attempts=CASE WHEN login_attempts.window_at<now()-interval '15 minutes' THEN 1 ELSE login_attempts.attempts+1 END,window_at=CASE WHEN login_attempts.window_at<now()-interval '15 minutes' THEN now() ELSE login_attempts.window_at END RETURNING attempts`,
      [login],
    );
    if (attempts[0]!.attempts > 10)
      throw new DomainError(
        "로그인 시도가 많습니다. 15분 뒤 다시 시도하세요.",
        429,
      );
    const user = (
      await this.store.query<User>("SELECT * FROM app_users WHERE login=$1", [
        login,
      ])
    )[0];
    const valid = await checkPassword(
      data.password,
      user?.password_hash ?? `${"0".repeat(32)}:${"0".repeat(128)}`,
    );
    if (!user || !valid)
      throw new DomainError("계정 또는 비밀번호를 확인하세요.", 401);
    await this.store.query("DELETE FROM login_attempts WHERE login=$1", [
      login,
    ]);
    return this.newSession(user);
  }
  private credential(request: Request) {
    const bearer = request.headers.get("authorization");
    if (bearer?.startsWith("Bearer ") && bearer.length > 7)
      return { token: bearer.slice(7), api: true };
    const cookie = request.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("pm_session="))
      ?.slice(11);
    return cookie ? { token: cookie, api: false } : null;
  }
  async resolve(
    request: Request,
    requireAccess = true,
    requireWorkspace = true,
  ): Promise<{ actor: Actor; user: ReturnType<typeof publicUser> | null }> {
    const origin = request.headers.get("origin");
    const url = new URL(request.url);
    const allowed = new URL(
      process.env.APP_URL ??
        `${url.protocol}//${request.headers.get("host") ?? url.host}`,
    ).origin;
    if (origin && origin !== allowed)
      throw new DomainError("허용되지 않은 요청 출처입니다.", 403);
    if (demoMode()) return { actor: authenticate(request), user: null };
    const credential = this.credential(request);
    let user: User | undefined;
    if (credential && credential.token.length < 500) {
      user = (
        await this.store.query<User>(
          credential.api
            ? "SELECT *,api_workspace_id AS current_workspace FROM app_users WHERE api_token_hash=$1"
            : `SELECT u.*,s.workspace_id AS current_workspace FROM app_users u JOIN app_sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()`,
          [tokenHash(credential.token)],
        )
      )[0];
    }
    if (!user) {
      const registered = (
        await this.store.query<{ count: string }>(
          "SELECT count(*)::text FROM app_users",
        )
      )[0]!.count;
      if (registered === "0" || process.env.ALLOW_LEGACY_ACCESS === "true")
        return { actor: authenticate(request), user: null };
      throw new DomainError("로그인이 필요합니다.", 401);
    }
    const workspaceId =
      request.headers.get("x-workspace-id") ?? user.current_workspace ?? "main";
    const useApp =
      requireAccess &&
      requireWorkspace &&
      workspaceId === appWorkspaceId() &&
      githubAppConfigured();
    let githubToken: string | undefined;
    let githubTokenProvider: (() => Promise<string>) | undefined;
    if (requireAccess && user.github_cipher && !useApp) {
      githubToken = decryptToken(user.github_cipher);
      if (Date.now() - new Date(user.permissions_at).getTime() > 60000) {
        let access: Awaited<ReturnType<Users["verifyGithub"]>>;
        try {
          access = await this.verifyGithub(githubToken);
        } catch {
          await this.store.query(
            "UPDATE app_users SET repositories='[]'::jsonb,permissions_at=to_timestamp(0) WHERE id=$1",
            [user.id],
          );
          throw new DomainError(
            "GitHub 접근 권한을 확인하지 못했습니다. 프로필에서 토큰을 갱신하세요.",
            403,
          );
        }
        if (access.login !== (user.github_login ?? user.login))
          throw new DomainError("GitHub 계정이 일치하지 않습니다.", 403);
        await this.store.query(
          "UPDATE app_users SET repositories=$2::jsonb,permissions_at=now(),role=$3 WHERE id=$1",
          [user.id, JSON.stringify(access.repositories), access.role],
        );
        user.role = access.role;
        user.repositories = access.repositories;
        user.permissions_at = new Date().toISOString();
      }
    }
    if (credential?.api && workspaceId !== (user.current_workspace ?? "main"))
      throw new DomainError(
        "이 MCP 토큰은 발급된 워크스페이스에서만 사용할 수 있습니다.",
        403,
      );
    let workspaceRole: WorkspaceRole = "viewer";
    if (requireWorkspace) {
      try {
        workspaceRole = (
          await new Workspaces(this.store, user.id).get(workspaceId)
        ).role;
      } catch (error) {
        if (requireAccess) throw error;
      }
    }
    let repositories = useApp ? [] : user.repositories;
    if (requireAccess && requireWorkspace) {
      const shared = await this.sharedGithub(workspaceId);
      if (shared) {
        repositories = [...new Set([...repositories, ...shared.repositories])];
        githubToken = shared.token;
        githubTokenProvider = shared.tokenProvider;
      }
    }
    return {
      actor: {
        name: user.login,
        role:
          workspaceRole === "viewer" ||
          (credential?.api && user.api_role === "read")
            ? "read"
            : "write",
        workspaceRole,
        userId: user.id,
        workspaceId,
        admin: user.role === "admin",
        repositories,
        githubToken,
        ...(githubTokenProvider ? { githubTokenProvider } : {}),
      },
      user: publicUser(user),
    };
  }
  async profile(request: Request) {
    const resolved = await this.resolve(request, false);
    if (!resolved.actor.userId || !resolved.user)
      throw new DomainError("사용자 계정으로 로그인하세요.", 401);
    return resolved.user;
  }
  private requireSession(request: Request) {
    if (this.credential(request)?.api)
      throw new DomainError(
        "프로필 변경에는 브라우저 로그인이 필요합니다.",
        403,
      );
  }
  private async workspaceAdmin(request: Request) {
    this.requireSession(request);
    const resolved = await this.resolve(request, false);
    if (!resolved.user)
      throw new DomainError("사용자 계정으로 로그인하세요.", 401);
    const workspaceId = resolved.actor.workspaceId ?? "main";
    const workspace = await new Workspaces(this.store, resolved.user.id).get(
      workspaceId,
    );
    return {
      user: resolved.user,
      workspaceId,
      name: workspace.name,
      description: workspace.description,
      admin:
        workspace.owner_id === resolved.user.id || workspace.role === "admin",
      ownerId: workspace.owner_id,
      viewerId: resolved.user.id,
      role: workspace.role,
      inviteOnly: workspace.invite_only,
    };
  }

  async workspace(request: Request) {
    const access = await this.workspaceAdmin(request);
    let appConnection:
      | {
          kind: "app";
          login: string;
          last4: string;
          repositoryCount: number;
          appId: string;
          error?: string;
        }
      | undefined;
    if (access.workspaceId === appWorkspaceId() && githubAppConfigured()) {
      try {
        const app = configuredGitHubApp(this.fetcher)!;
        const scope = await app.access();
        appConnection = {
          kind: "app",
          login: `GitHub App #${process.env.GITHUB_APP_ID}`,
          last4: "",
          repositoryCount: scope.repositories.length,
          appId: process.env.GITHUB_APP_ID!,
        };
      } catch (error) {
        appConnection = {
          kind: "app",
          login: `GitHub App #${process.env.GITHUB_APP_ID}`,
          last4: "",
          repositoryCount: 0,
          appId: process.env.GITHUB_APP_ID!,
          error:
            error instanceof GitHubRateLimitError
              ? error.message
              : "GitHub App 설치·권한·개인 키 연결을 확인하세요.",
        };
      }
    }
    const shared = (
      await this.store.query<{
        github_login: string;
        github_last4: string;
        repositories: string[];
      }>(
        "SELECT github_login,github_last4,repositories FROM workspace_github WHERE workspace_id=$1",
        [access.workspaceId],
      )
    )[0];
    const members = await this.store.query<{
      id: string;
      login: string;
      display_name: string;
      role: WorkspaceRole;
    }>(
      "SELECT u.id,u.login,u.display_name,m.role FROM app_users u JOIN workspace_members m ON m.user_id=u.id WHERE m.workspace_id=$1 ORDER BY u.created_at",
      [access.workspaceId],
    );
    const invites = access.admin
      ? await this.store.query(
          "SELECT i.id,i.expected_login,i.status,i.expires_at,i.created_at,i.member_role,u.login AS created_by FROM workspace_invites i JOIN app_users u ON u.id=i.created_by WHERE i.workspace_id=$1 ORDER BY i.created_at DESC LIMIT 100",
          [access.workspaceId],
        )
      : [];
    return {
      id: access.workspaceId,
      name: access.name,
      description: access.description,
      organization: process.env.GITHUB_ORG ?? "",
      githubConnection:
        appConnection ??
        (shared
          ? {
              kind: "pat" as const,
              login: shared.github_login,
              last4: shared.github_last4,
              repositoryCount: shared.repositories.length,
            }
          : null),
      inviteOnly: access.inviteOnly,
      admin: access.admin,
      viewerId: access.viewerId,
      role: access.role,
      ownerId: access.ownerId,
      members: members.map((m) => ({ ...m, owner: m.id === access.ownerId })),
      invites,
    };
  }
  async updateMember(request: Request, input: unknown) {
    this.requireSession(request);
    const resolved = await this.resolve(request);
    if (!resolved.user)
      throw new DomainError("개인 사용자 인증이 필요합니다.", 401);
    return new Workspaces(this.store, resolved.user.id).updateMember(
      resolved.actor.workspaceId ?? "main",
      input,
    );
  }
  async removeMember(request: Request, input: unknown) {
    this.requireSession(request);
    const resolved = await this.resolve(request);
    if (!resolved.user)
      throw new DomainError("개인 사용자 인증이 필요합니다.", 401);
    return new Workspaces(this.store, resolved.user.id).removeMember(
      resolved.actor.workspaceId ?? "main",
      input,
    );
  }
  async updateWorkspace(request: Request, input: unknown) {
    const access = await this.workspaceAdmin(request);
    if (!access.admin)
      throw new DomainError(
        "워크스페이스 관리자만 설정을 변경할 수 있습니다.",
        403,
      );
    const { inviteOnly } = z.object({ inviteOnly: z.boolean() }).parse(input);
    if (access.workspaceId !== "main" && !inviteOnly)
      throw new DomainError(
        "새 워크스페이스는 초대받은 멤버만 참여할 수 있습니다.",
      );
    await this.store.query(
      "UPDATE workspace_settings SET invite_only=$1 WHERE id=$2",
      [inviteOnly, access.workspaceId],
    );
    return this.workspace(request);
  }
  async createInvite(request: Request, input: unknown) {
    const access = await this.workspaceAdmin(request);
    if (!access.admin)
      throw new DomainError("워크스페이스 관리자만 초대할 수 있습니다.", 403);
    const { login, role } = z
      .object({
        role: z.enum(["member", "viewer"]).default("member"),
        login: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9-]{1,39}$/)
          .optional(),
      })
      .parse(input);
    const token = `pminv_${randomBytes(32).toString("base64url")}`;
    const id = randomUUID();
    await this.store.query(
      "INSERT INTO workspace_invites(id,token_hash,created_by,expected_login,expires_at,workspace_id,member_role) VALUES($1,$2,$3,$4,now()+interval '7 days',$5,$6)",
      [
        id,
        tokenHash(token),
        access.user.id,
        login?.toLowerCase() ?? null,
        access.workspaceId,
        role,
      ],
    );
    const url = new URL(process.env.APP_URL ?? request.url);
    url.pathname = "/";
    url.search = "";
    url.hash = `invite=${token}`;
    return { id, url: url.href };
  }
  async revokeInvite(request: Request, input: unknown) {
    const access = await this.workspaceAdmin(request);
    if (!access.admin)
      throw new DomainError(
        "워크스페이스 관리자만 초대를 취소할 수 있습니다.",
        403,
      );
    const { id } = z.object({ id: z.string().uuid() }).parse(input);
    await this.store.query(
      "UPDATE workspace_invites SET status='revoked' WHERE id=$1 AND workspace_id=$2 AND status='pending'",
      [id, access.workspaceId],
    );
    return { revoked: true };
  }
  async listWorkspaces(request: Request) {
    this.requireSession(request);
    const resolved = await this.resolve(request, false, false);
    if (!resolved.user)
      throw new DomainError("사용자 계정으로 로그인하세요.", 401);
    return {
      currentId: resolved.actor.workspaceId ?? "main",
      workspaces: await new Workspaces(this.store, resolved.user.id).list(),
    };
  }
  async createWorkspace(request: Request, input: unknown) {
    this.requireSession(request);
    const resolved = await this.resolve(request, false, false);
    if (!resolved.user)
      throw new DomainError("사용자 계정으로 로그인하세요.", 401);
    return new Workspaces(this.store, resolved.user.id).create(input);
  }
  async switchWorkspace(request: Request, input: unknown) {
    this.requireSession(request);
    const user = await this.profile(request);
    const { id } = z.object({ id: z.string() }).parse(input);
    await new Workspaces(this.store, user.id).get(id);
    await this.store.query(
      "UPDATE app_sessions SET workspace_id=$1 WHERE token_hash=$2",
      [id, tokenHash(this.credential(request)!.token)],
    );
    return { id };
  }
  async acceptInvite(request: Request, input: unknown) {
    this.requireSession(request);
    const resolved = await this.resolve(request, false, false);
    if (!resolved.user)
      throw new DomainError("사용자 계정으로 로그인하세요.", 401);
    const { token } = z
      .object({ token: z.string().min(20).max(200) })
      .parse(input);
    const rows = await this.store.query<{ workspace_id: string }>(
      "WITH accepted AS (UPDATE workspace_invites SET status='accepted',accepted_by=$2 WHERE token_hash=$1 AND (expected_login IS NULL OR expected_login=$3) AND ((status='pending' AND expires_at>now()) OR (status='accepted' AND accepted_by=$2)) RETURNING workspace_id,member_role),joined AS (INSERT INTO workspace_members(workspace_id,user_id,role) SELECT workspace_id,$2,member_role FROM accepted ON CONFLICT DO NOTHING) SELECT workspace_id FROM accepted",
      [tokenHash(token), resolved.user.id, resolved.user.login],
    );
    if (!rows[0])
      throw new DomainError(
        "초대가 만료·취소되었거나 대상 계정이 다릅니다.",
        403,
      );
    await this.switchWorkspace(request, { id: rows[0].workspace_id });
    return { id: rows[0].workspace_id };
  }
  async update(request: Request, input: unknown) {
    this.requireSession(request);
    const profile = await this.profile(request);
    const data = z
      .strictObject({
        displayName: z.string().trim().min(1).max(100).optional(),
        githubToken: z.string().min(1).max(1000).optional(),
      })
      .parse(input);
    if (data.githubToken) {
      const access = await this.verifyGithub(data.githubToken);
      if (profile.githubLogin && access.login !== profile.githubLogin)
        throw new DomainError(
          "기존 프로필과 동일한 GitHub 계정의 토큰을 사용하세요.",
          403,
        );
      await this.store.query(
        "UPDATE app_users SET github_cipher=$2,github_last4=$3,repositories=$4::jsonb,permissions_at=now(),updated_at=now(),github_login=$5 WHERE id=$1",
        [
          profile.id,
          encryptToken(data.githubToken),
          data.githubToken.slice(-4),
          JSON.stringify(access.repositories),
          access.login,
        ],
      );
    }
    if (data.displayName)
      await this.store.query(
        "UPDATE app_users SET display_name=$2,updated_at=now() WHERE id=$1",
        [profile.id, data.displayName],
      );
    return this.profile(request);
  }
  async mcpStatus(request: Request) {
    this.requireSession(request);
    const resolved = await this.resolve(request);
    if (!resolved.user)
      throw new DomainError("개인 사용자 인증이 필요합니다.", 401);
    const workspaceId = resolved.actor.workspaceId ?? "main";
    const workspace = await new Workspaces(this.store, resolved.user.id).get(
      workspaceId,
    );
    const connections = await this.store.query<{
      last_seen: string | Date;
      client_name: string | null;
      method: string;
      protocol_version: string | null;
    }>(
      "SELECT c.last_seen,c.client_name,c.method,c.protocol_version FROM mcp_connections c JOIN app_users u ON u.id=c.user_id WHERE c.user_id=$1 AND c.workspace_id=$2 AND c.token_hash=u.api_token_hash AND u.api_workspace_id=$2",
      [resolved.user.id, workspaceId],
    );
    return {
      ...connectionAddress(process.env.APP_URL),
      workspace: { id: workspaceId, name: workspace.name },
      effectiveRole: resolved.actor.role,
      workspaceRole: resolved.actor.workspaceRole,
      token: {
        exists: !!resolved.user.serviceTokenLast4,
        currentWorkspace: resolved.user.serviceTokenWorkspaceId === workspaceId,
        role: resolved.user.serviceTokenRole,
      },
      lastConnection: connections[0]
        ? {
            at: new Date(connections[0].last_seen).toISOString(),
            client: connections[0].client_name,
            method: connections[0].method,
            protocolVersion: connections[0].protocol_version,
          }
        : null,
    };
  }
  async rotateApiToken(request: Request, role: "read" | "write") {
    this.requireSession(request);
    const resolved = await this.resolve(request);
    const user = resolved.user;
    if (!user) throw new DomainError("사용자 계정으로 로그인하세요.", 401);
    if (role === "write" && resolved.actor.role !== "write")
      throw new DomainError(
        "현재 워크스페이스에서는 조회 전용 토큰만 발급할 수 있습니다.",
        403,
      );
    const token = `cpm_${randomBytes(32).toString("base64url")}`;
    await this.store.query(
      "UPDATE app_users SET api_token_hash=$2,api_last4=$3,api_role=$4,api_workspace_id=$5,updated_at=now() WHERE id=$1",
      [
        user.id,
        tokenHash(token),
        token.slice(-4),
        role,
        resolved.actor.workspaceId ?? "main",
      ],
    );
    return { token, role, workspaceId: resolved.actor.workspaceId ?? "main" };
  }
  async revokeApiToken(request: Request) {
    this.requireSession(request);
    const user = await this.profile(request);
    await this.store.query(
      "UPDATE app_users SET api_token_hash=NULL,api_last4=NULL WHERE id=$1",
      [user.id],
    );
  }
  async logout(request: Request) {
    const credential = this.credential(request);
    if (credential && !credential.api)
      await this.store.query("DELETE FROM app_sessions WHERE token_hash=$1", [
        tokenHash(credential.token),
      ]);
  }
  async changePassword(request: Request, input: unknown) {
    this.requireSession(request);
    const user = await this.profile(request);
    const data = z
      .strictObject({
        currentPassword: z.string().max(200),
        newPassword: password,
      })
      .parse(input);
    const row = (
      await this.store.query<User>("SELECT * FROM app_users WHERE id=$1", [
        user.id,
      ])
    )[0]!;
    if (!(await checkPassword(data.currentPassword, row.password_hash)))
      throw new DomainError("현재 비밀번호를 확인하세요.", 403);
    await this.store.query(
      "UPDATE app_users SET password_hash=$2 WHERE id=$1",
      [user.id, await hashPassword(data.newPassword)],
    );
    const credential = this.credential(request);
    await this.store.query(
      "DELETE FROM app_sessions WHERE user_id=$1 AND token_hash<>$2",
      [user.id, tokenHash(credential?.token ?? "")],
    );
    return { updated: true };
  }
}
