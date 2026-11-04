import { checkGitHubBudget, observeGitHubBudget } from "./rate-limit";
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { DomainError } from "../core/model";

const installationSchema = z.object({
  id: z.number().int().positive(),
  app_id: z.number().int().positive(),
  account: z.object({ login: z.string() }),
  suspended_at: z.string().nullable(),
});
const repositorySchema = z.object({
  full_name: z.string().regex(/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/),
});
type Options = {
  appId: string;
  clientId?: string;
  installationId?: string;
  organization: string;
  privateKey: string;
  fetch?: typeof fetch;
  now?: () => number;
};

export class GitHubApp {
  private key: KeyObject;
  private installed?: { id: number; until: number };
  private credential?: { token: string; until: number };
  private repositories?: { names: string[]; until: number };
  private tokenPending?: Promise<string>;
  private accessPending?: Promise<{ token: string; repositories: string[] }>;
  private generation = 0;
  constructor(private options: Options) {
    if (
      !/^\d+$/.test(options.appId) ||
      !/^[A-Za-z0-9_-]+$/.test(options.organization) ||
      (options.installationId && !/^\d+$/.test(options.installationId))
    )
      throw new DomainError(
        "GitHub App ID·설치 ID·조직 설정을 확인하세요.",
        503,
      );
    try {
      this.key = createPrivateKey(options.privateKey);
      if (
        this.key.asymmetricKeyType !== "rsa" ||
        (this.key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
      )
        throw new Error();
    } catch {
      throw new DomainError("GitHub App 개인 키 설정을 확인하세요.", 503);
    }
  }
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  private jwt() {
    const seconds = Math.floor(this.now() / 1000);
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", typ: "JWT" }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iat: seconds - 60,
        exp: seconds + 540,
        iss: this.options.clientId || this.options.appId,
      }),
    ).toString("base64url");
    const data = `${header}.${payload}`;
    return `${data}.${sign("RSA-SHA256", Buffer.from(data), this.key).toString("base64url")}`;
  }
  private async request(path: string, token: string, method = "GET") {
    const rateKey = `app:${this.options.appId}:${this.options.installationId ?? this.options.organization}`;
    const bucket = path.startsWith("/installation/")
      ? rateKey
      : `${rateKey}:auth`;
    checkGitHubBudget(bucket);
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(
        `https://api.github.com${path}`,
        {
          method,
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2026-03-10",
            "User-Agent": "cloud-pm-agent",
            Authorization: `Bearer ${token}`,
            ...(method === "POST"
              ? { "Content-Type": "application/json" }
              : {}),
          },
          ...(method === "POST" ? { body: "{}" } : {}),
        },
      );
    } catch (error) {
      console.error("github_app_network_failed", {
        path,
        name: error instanceof Error ? error.name : "unknown",
        cause:
          error instanceof Error &&
          error.cause &&
          typeof error.cause === "object" &&
          "code" in error.cause
            ? String(error.cause.code)
            : undefined,
      });
      throw new DomainError(
        "GitHub App 연결을 확인하지 못했습니다. 잠시 후 다시 시도하세요.",
        503,
      );
    }
    await observeGitHubBudget(response, bucket);
    if (!response.ok) {
      let reason = "";
      try {
        reason = String((await response.clone().json()).message ?? "").slice(
          0,
          200,
        );
      } catch {}
      console.error("github_app_request_failed", {
        path,
        status: response.status,
        reason,
        remaining: response.headers.get("x-ratelimit-remaining"),
        retryAfter: response.headers.get("retry-after"),
      });
      this.invalidate();
      throw new DomainError(
        response.status === 403 &&
          (response.headers.get("x-ratelimit-remaining") === "0" ||
            response.headers.has("retry-after"))
          ? `GitHub API 요청 제한으로 잠시 조회할 수 없습니다 (HTTP ${response.status}). 잠시 후 다시 시도하세요.`
          : response.status === 401
            ? `GitHub App 인증 요청이 거부되었습니다 (HTTP ${response.status}). 서버의 App 키와 시간을 확인하세요.`
            : `GitHub App 조회가 거부되었습니다 (HTTP ${response.status}). 설치된 저장소와 App 접근 권한을 확인하세요.`,
        503,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new DomainError("GitHub App 응답 형식을 확인하지 못했습니다.", 503);
    }
  }
  invalidate() {
    this.generation++;
    this.installed = undefined;
    this.credential = undefined;
    this.repositories = undefined;
  }
  private async installation() {
    if (this.installed && this.installed.until > this.now())
      return this.installed.id;
    const generation = this.generation;
    const path = this.options.installationId
      ? `/app/installations/${this.options.installationId}`
      : `/orgs/${this.options.organization}/installation`;
    const row = installationSchema.safeParse(
      await this.request(path, this.jwt()),
    );
    if (generation !== this.generation)
      throw new DomainError(
        "GitHub App 설치가 변경되었습니다. 다시 연결하세요.",
        503,
      );
    if (
      !row.success ||
      String(row.data.app_id) !== this.options.appId ||
      row.data.account.login.toLowerCase() !==
        this.options.organization.toLowerCase() ||
      row.data.suspended_at
    ) {
      this.invalidate();
      throw new DomainError(
        "설정한 조직의 활성 GitHub App 설치를 확인하세요.",
        503,
      );
    }
    if (this.installed && this.installed.id !== row.data.id) {
      this.credential = undefined;
      this.repositories = undefined;
    }
    this.installed = { id: row.data.id, until: this.now() + 60000 };
    return row.data.id;
  }
  token = async (): Promise<string> => {
    if (this.credential && this.credential.until > this.now() + 60000)
      return this.credential.token;
    checkGitHubBudget(
      `app:${this.options.appId}:${this.options.installationId ?? this.options.organization}`,
    );
    if (this.tokenPending) return this.tokenPending;
    const generation = this.generation;
    this.tokenPending = (async () => {
      const id = await this.installation();
      const parsed = z
        .object({
          token: z.string().min(1).max(10000),
          expires_at: z.iso.datetime({ offset: true }),
        })
        .safeParse(
          await this.request(
            `/app/installations/${id}/access_tokens`,
            this.jwt(),
            "POST",
          ),
        );
      if (
        !parsed.success ||
        Date.parse(parsed.data.expires_at) <= this.now() + 60000
      )
        throw new DomainError(
          "GitHub App 설치 토큰의 유효기간을 확인하세요.",
          503,
        );
      if (generation !== this.generation)
        throw new DomainError(
          "GitHub App 설치가 변경되었습니다. 다시 연결하세요.",
          503,
        );
      this.credential = {
        token: parsed.data.token,
        until: Date.parse(parsed.data.expires_at),
      };
      return parsed.data.token;
    })().finally(() => {
      this.tokenPending = undefined;
    });
    return this.tokenPending;
  };
  async access() {
    if (this.accessPending) return this.accessPending;
    const generation = this.generation;
    this.accessPending = (async () => {
      await this.installation();
      const token = await this.token();
      if (generation !== this.generation)
        throw new DomainError(
          "GitHub App 설치가 변경되었습니다. 다시 연결하세요.",
          503,
        );
      if (this.repositories && this.repositories.until > this.now())
        return { token, repositories: [...this.repositories.names] };
      const names: string[] = [];
      for (let page = 1; page <= 100; page++) {
        const result = z
          .object({ repositories: z.array(repositorySchema) })
          .safeParse(
            await this.request(
              `/installation/repositories?per_page=100&page=${page}`,
              token,
            ),
          );
        if (!result.success)
          throw new DomainError(
            "GitHub App 저장소 응답을 확인하지 못했습니다.",
            503,
          );
        for (const row of result.data.repositories) {
          if (
            row.full_name.split("/")[0]?.toLowerCase() !==
            this.options.organization.toLowerCase()
          )
            throw new DomainError(
              "다른 조직의 GitHub App 저장소는 사용할 수 없습니다.",
              503,
            );
          names.push(row.full_name.toLowerCase());
        }
        if (result.data.repositories.length < 100) break;
        if (page === 100)
          throw new DomainError(
            "GitHub App 저장소 조회 범위를 초과했습니다.",
            503,
          );
      }
      if (generation !== this.generation)
        throw new DomainError(
          "GitHub App 설치가 변경되었습니다. 다시 연결하세요.",
          503,
        );
      this.repositories = {
        names: [...new Set(names)],
        until: this.now() + 60000,
      };
      return { token, repositories: [...this.repositories.names] };
    })().finally(() => {
      this.accessPending = undefined;
    });
    return this.accessPending;
  }
}

let cached:
  { signature: string; fetcher: typeof fetch; app: GitHubApp } | undefined;
export function githubAppConfigured() {
  return !!(
    process.env.GITHUB_APP_ID ||
    process.env.GITHUB_APP_PRIVATE_KEY_BASE64 ||
    process.env.GITHUB_APP_PRIVATE_KEY_PATH ||
    process.env.GITHUB_APP_CLIENT_ID ||
    process.env.GITHUB_APP_INSTALLATION_ID
  );
}
export function configuredGitHubApp(fetcher: typeof fetch = fetch) {
  if (!githubAppConfigured()) return undefined;
  const signature = JSON.stringify([
    process.env.GITHUB_APP_ID,
    process.env.GITHUB_APP_CLIENT_ID,
    process.env.GITHUB_APP_INSTALLATION_ID,
    process.env.GITHUB_ORG,
    process.env.GITHUB_APP_PRIVATE_KEY_BASE64,
    process.env.GITHUB_APP_PRIVATE_KEY_PATH,
  ]);
  if (cached?.signature === signature && cached.fetcher === fetcher)
    return cached.app;
  let privateKey: string;
  try {
    if (process.env.GITHUB_APP_PRIVATE_KEY_BASE64)
      privateKey = Buffer.from(
        process.env.GITHUB_APP_PRIVATE_KEY_BASE64,
        "base64",
      ).toString("utf8");
    else if (process.env.GITHUB_APP_PRIVATE_KEY_PATH)
      privateKey = readFileSync(
        process.env.GITHUB_APP_PRIVATE_KEY_PATH,
        "utf8",
      );
    else throw new Error();
  } catch {
    throw new DomainError("GitHub App 개인 키 설정이 필요합니다.", 503);
  }
  const app = new GitHubApp({
    appId: process.env.GITHUB_APP_ID ?? "",
    clientId: process.env.GITHUB_APP_CLIENT_ID,
    installationId: process.env.GITHUB_APP_INSTALLATION_ID,
    organization: process.env.GITHUB_ORG ?? "",
    privateKey,
    fetch: fetcher,
  });
  cached = { signature, fetcher, app };
  return app;
}
export function appWorkspaceId() {
  return process.env.GITHUB_APP_WORKSPACE_ID || "main";
}
