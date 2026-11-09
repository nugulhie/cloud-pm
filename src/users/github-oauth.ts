import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Store } from "../db/store";
import { DomainError } from "../core/model";
import { encryptToken, decryptToken, tokenHash } from "./crypto";
import { Users } from "./service";

const cookieValue = (request: Request, name: string) =>
  request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + "="))
    ?.slice(name.length + 1) ?? "";
export const sessionCookie = (value: string, request: Request) =>
  `pm_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${new URL(process.env.APP_URL ?? request.url).protocol === "https:" ? "; Secure" : ""}`;
export class GitHubOAuth {
  constructor(
    private store: Store,
    private fetcher: typeof fetch = fetch,
  ) {}
  config() {
    const clientId =
      process.env.GITHUB_OAUTH_CLIENT_ID ||
      process.env.GITHUB_APP_CLIENT_ID ||
      "";
    const secret =
      process.env.GITHUB_OAUTH_CLIENT_SECRET ||
      process.env.GITHUB_APP_CLIENT_SECRET ||
      "";
    const organization = process.env.GITHUB_ORG ?? "";
    const base = z.url().safeParse(process.env.APP_URL);
    const callbackUrl = base.success
      ? new URL("/api/auth/github/callback", base.data).href
      : null;
    const enabled = !!(
      clientId &&
      secret &&
      /^[A-Za-z0-9_-]+$/.test(organization) &&
      callbackUrl &&
      /^[a-f0-9]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY ?? "")
    );
    return { enabled, organization, callbackUrl, clientId, secret };
  }
  publicConfig() {
    const { enabled, organization, callbackUrl } = this.config();
    return { enabled, organization, callbackUrl };
  }
  private browserCookie(value: string, clear = false) {
    return `pm_github_oauth=${value}; HttpOnly; SameSite=Lax; Path=/api/auth/github; Max-Age=${clear ? 0 : 600}${this.config().callbackUrl?.startsWith("https:") ? "; Secure" : ""}`;
  }
  async start(request: Request) {
    const config = this.config();
    if (!config.enabled)
      throw new DomainError(
        "GitHub OAuth 설정이 필요합니다. 관리자에게 Client Secret과 콜백 등록을 요청하세요.",
        503,
      );
    if (request.headers.has("authorization"))
      throw new DomainError(
        "GitHub 계정 연결에는 브라우저 로그인이 필요합니다.",
        403,
      );
    const intent = z
      .enum(["signin", "link"])
      .default("signin")
      .parse(new URL(request.url).searchParams.get("intent") ?? undefined);
    const returnTo = new URL(request.url).searchParams.get("returnTo");
    let returnPath: string | null = null;
    if (returnTo) {
      const target = new URL(returnTo, process.env.APP_URL ?? request.url);
      if (
        !returnTo.startsWith("/") ||
        returnTo.startsWith("//") ||
        target.origin !== new URL(process.env.APP_URL ?? request.url).origin ||
        target.pathname !== "/mcp/consent" ||
        !z.string().uuid().safeParse(target.searchParams.get("request")).success
      )
        throw new DomainError("잘못된 인증 복귀 경로입니다.", 400);
      returnPath = target.pathname + target.search;
    }
    let linkUserId: string | undefined;
    const session = cookieValue(request, "pm_session");
    if (intent === "link")
      linkUserId = (await new Users(this.store, this.fetcher).profile(request))
        .id;
    const state = randomBytes(32).toString("base64url"),
      browser = randomBytes(32).toString("base64url"),
      verifier = randomBytes(32).toString("base64url");
    await this.store.transaction(async (store) => {
      await store.query(
        "DELETE FROM github_oauth_states WHERE expires_at<now()",
      );
      await store.query(
        "INSERT INTO github_oauth_states(state_hash,browser_hash,verifier_cipher,intent,link_user_id,link_session_hash,return_path,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '10 minutes')",
        [
          tokenHash(state),
          tokenHash(browser),
          encryptToken(verifier),
          intent,
          linkUserId ?? null,
          linkUserId ? tokenHash(session) : null,
          returnPath,
        ],
      );
    });
    const url = new URL("https://github.com/login/oauth/authorize");
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.callbackUrl!,
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      allow_signup: "false",
      prompt: "select_account",
    }).toString();
    return { url: url.href, cookie: this.browserCookie(browser) };
  }
  async callback(request: Request) {
    const config = this.config();
    if (!config.enabled)
      throw new DomainError("GitHub OAuth 설정이 필요합니다.", 503);
    const query = new URL(request.url).searchParams;
    const state = query.get("state"),
      browser = cookieValue(request, "pm_github_oauth");
    if (
      !state ||
      !/^[A-Za-z0-9_-]{43}$/.test(state) ||
      !/^[A-Za-z0-9_-]{43}$/.test(browser)
    )
      throw new DomainError(
        "인증 상태를 확인하지 못했습니다. 다시 시작하세요.",
        400,
      );
    // 브라우저에 바인딩된 state를 원격 토큰 교환 전에 한 번만 소비한다.
    const saved = (
      await this.store.query<{
        verifier_cipher: string;
        intent: string;
        link_user_id: string | null;
        link_session_hash: string | null;
        return_path: string | null;
      }>(
        "UPDATE github_oauth_states SET used_at=now() WHERE state_hash=$1 AND browser_hash=$2 AND used_at IS NULL AND expires_at>now() RETURNING *",
        [tokenHash(state), tokenHash(browser)],
      )
    )[0];
    if (!saved)
      throw new DomainError(
        "만료되었거나 이미 사용한 인증 요청입니다. 다시 시작하세요.",
        409,
      );
    if (saved.intent === "link") {
      if (
        request.headers.has("authorization") ||
        tokenHash(cookieValue(request, "pm_session")) !==
          saved.link_session_hash
      )
        throw new DomainError(
          "기존 로그인 세션이 변경되었습니다. 다시 연결하세요.",
          401,
        );
      const current = await new Users(this.store, this.fetcher).profile(
        request,
      );
      if (current.id !== saved.link_user_id)
        throw new DomainError("기존 로그인 계정이 변경되었습니다.", 401);
    }
    if (query.has("error"))
      throw new DomainError("GitHub 인증이 취소되었습니다.", 400);
    const code = z.string().min(1).max(1000).parse(query.get("code"));
    const response = await this.fetcher(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.secret,
          code,
          redirect_uri: config.callbackUrl!,
          code_verifier: decryptToken(saved.verifier_cipher),
        }),
      },
    );
    if (!response.ok)
      throw new DomainError(
        "GitHub 인증 토큰을 확인하지 못했습니다. 다시 시작하세요.",
        502,
      );
    const token = z
      .object({ access_token: z.string().min(1), token_type: z.string() })
      .safeParse(await response.json());
    if (!token.success || token.data.token_type.toLowerCase() !== "bearer")
      throw new DomainError(
        "GitHub 인증이 만료되었거나 설정이 일치하지 않습니다. 다시 시작하세요.",
        400,
      );
    const get = async (path: string) => {
      const r = await this.fetcher("https://api.github.com" + path, {
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${token.data.access_token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
          "User-Agent": "cloud-pm-agent",
        },
      });
      if (!r.ok)
        throw new DomainError(
          "GitHub 사용자 또는 조직 멤버십을 확인하지 못했습니다. 조직 Members 읽기 권한과 활성 멤버십을 확인하세요.",
          403,
        );
      return r.json();
    };
    const user = z
      .object({
        id: z.number().int().positive().safe(),
        login: z.string().regex(/^[A-Za-z0-9-]{1,39}$/),
        name: z.string().nullable(),
        type: z.literal("User"),
      })
      .parse(await get("/user"));
    const membership = z
      .object({ state: z.literal("active") })
      .safeParse(
        await get(
          "/user/memberships/orgs/" + encodeURIComponent(config.organization),
        ),
      );
    if (!membership.success)
      throw new DomainError(
        "활성 GitHub 조직 구성원만 참여할 수 있습니다.",
        403,
      );
    const session = await new Users(
      this.store,
      this.fetcher,
    ).completeGitHubIdentity(
      {
        id: String(user.id),
        login: user.login,
        name: user.name ?? user.login,
        org: config.organization,
      },
      saved.link_user_id ?? undefined,
    );
    return {
      session,
      cookie: this.browserCookie("", true),
      returnTo: saved.return_path,
    };
  }
  clearCookie() {
    return this.browserCookie("", true);
  }
}
