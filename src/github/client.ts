import {
  checkGitHubBudget,
  observeGitHubBudget,
  tokenRateKey,
  GitHubRateLimitError,
} from "./rate-limit";
import { Buffer } from "node:buffer";
import { z } from "zod";
import { parseTaskYaml, type PullRequestSnapshot } from "../completion/index";

const repositorySchema = z.string().regex(/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/);
const shaSchema = z.string().regex(/^[a-f0-9]{40}$/i);
const entrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.string(),
});
const fileSchema = z.object({
  type: z.literal("file"),
  encoding: z.literal("base64"),
  size: z.number().int().min(0).max(65536),
  content: z.string(),
});
const prSchema = z.object({
  state: z.enum(["open", "closed"]),
  merged_at: z.iso.datetime({ offset: true }).nullable(),
  base: z.object({ ref: z.string().min(1) }),
});

export class GitHubError extends Error {
  constructor(
    public readonly status: number,
    public readonly emptyRepository = false,
  ) {
    super(
      `GitHub 조회 실패 (HTTP ${status}). 권한, API 제한 및 저장소 경로를 확인하세요.`,
    );
  }
}

export class GitHubClient {
  constructor(
    private readonly options: {
      token?: string;
      tokenProvider?: () => Promise<string>;
      installationScoped?: boolean;
      rateKey?: string;
      reserve?: number;
      fetch?: typeof fetch;
    } = {},
  ) {}

  async createIssue(
    repository: string,
    input: { title: string; body: string; assignees?: string[] },
  ) {
    repositorySchema.parse(repository);
    z.object({
      title: z.string().min(1).max(300),
      body: z.string().max(65536),
      assignees: z
        .array(z.string().regex(/^[A-Za-z0-9_-]{1,100}$/))
        .max(10)
        .optional(),
    }).parse(input);
    const rateKey = this.options.rateKey ?? tokenRateKey(this.options.token);
    checkGitHubBudget(rateKey, this.options.reserve);
    const token = this.options.tokenProvider
      ? await this.options.tokenProvider()
      : this.options.token;
    const response = await (this.options.fetch ?? fetch)(
      `https://api.github.com/repos/${repository}/issues`,
      {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2026-03-10",
          "User-Agent": "cloud-pm-agent",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(input),
      },
    );
    await observeGitHubBudget(response, rateKey);
    if (!response.ok) throw new GitHubError(response.status);
    return z
      .object({
        number: z.number().int().positive(),
        html_url: z
          .string()
          .url()
          .refine((url) => new URL(url).origin === "https://github.com"),
        title: z.string(),
        body: z.string().nullable(),
        user: z.object({ login: z.string() }),
        updated_at: z.string(),
        assignees: z.array(z.object({ login: z.string() })).default([]),
      })
      .parse(await response.json());
  }

  async get(path: string): Promise<unknown> {
    const rateKey = this.options.rateKey ?? tokenRateKey(this.options.token);
    checkGitHubBudget(rateKey, this.options.reserve);
    const token = this.options.tokenProvider
      ? await this.options.tokenProvider()
      : this.options.token;
    const response = await (this.options.fetch ?? fetch)(
      `https://api.github.com${path}`,
      {
        method: "GET",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
          "User-Agent": "cloud-pm-agent",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    await observeGitHubBudget(response, rateKey);
    if (!response.ok) {
      let emptyRepository = false;
      if (response.status === 409) {
        try {
          emptyRepository =
            (await response.clone().json()).message ===
            "Git Repository is empty.";
        } catch {}
      }
      throw new GitHubError(response.status, emptyRepository);
    }
    return response.json();
  }

  async listAssignees(repository: string) {
    repositorySchema.parse(repository);
    const people = z
      .array(
        z.object({
          login: z.string(),
          type: z.string().default("User"),
        }),
      )
      .parse(await this.paginate(`/repos/${repository}/assignees`));
    return people
      .filter((person) => person.type === "User")
      .map(({ login }) => ({
        login: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,100}$/)
          .parse(login),
      }));
  }

  async canAssign(repository: string, login: string) {
    repositorySchema.parse(repository);
    z.string()
      .regex(/^[A-Za-z0-9_-]{1,100}$/)
      .parse(login);
    const rateKey = this.options.rateKey ?? tokenRateKey(this.options.token);
    checkGitHubBudget(rateKey, this.options.reserve);
    const token = this.options.tokenProvider
      ? await this.options.tokenProvider()
      : this.options.token;
    const response = await (this.options.fetch ?? fetch)(
      `https://api.github.com/repos/${repository}/assignees/${encodeURIComponent(login)}`,
      {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
          "User-Agent": "cloud-pm-agent",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    await observeGitHubBudget(response, rateKey);
    if (response.status === 204) return true;
    if (response.status === 404) return false;
    throw new GitHubError(response.status);
  }

  async listOrganizationRepositories(organization: string) {
    z.string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .parse(organization);
    if (this.options.installationScoped) {
      const repositories: { full_name: string }[] = [];
      for (let page = 1; page <= 100; page++) {
        const result = z
          .object({
            repositories: z.array(z.object({ full_name: repositorySchema })),
          })
          .parse(
            await this.get(
              `/installation/repositories?per_page=100&page=${page}`,
            ),
          );
        for (const repository of result.repositories)
          if (
            repository.full_name.split("/")[0]?.toLowerCase() ===
            organization.toLowerCase()
          )
            repositories.push(repository);
        if (result.repositories.length < 100) return repositories;
      }
      throw new Error("GitHub App 저장소 조회 범위를 초과했습니다.");
    }
    return this.paginate(`/orgs/${organization}/repos?type=all`);
  }

  async paginate(path: string): Promise<unknown[]> {
    const all: unknown[] = [];
    for (let page = 1; page <= 100; page++) {
      const batch = z
        .array(z.unknown())
        .parse(
          await this.get(
            `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
          ),
        );
      all.push(...batch);
      if (batch.length < 100) return all;
    }
    throw new Error(
      "페이지 조회 한도를 초과하여 완전한 동기화를 보장할 수 없습니다.",
    );
  }

  async readPullRequest(
    repository: string,
    number: number,
  ): Promise<PullRequestSnapshot> {
    repositorySchema.parse(repository);
    z.number().int().positive().parse(number);
    const pr = prSchema.parse(
      await this.get(`/repos/${repository}/pulls/${number}`),
    );
    return {
      state: pr.state,
      mergedAt: pr.merged_at,
      targetBranch: pr.base.ref,
      observedAt: new Date().toISOString(),
    };
  }

  async loadTasks(repository: string) {
    repositorySchema.parse(repository);
    const repo = z
      .object({ default_branch: z.string().min(1) })
      .parse(await this.get(`/repos/${repository}`));
    let rawRef: unknown;
    try {
      rawRef = await this.get(
        `/repos/${repository}/git/ref/heads/${encodeURIComponent(repo.default_branch)}`,
      );
    } catch (error) {
      // 커밋이 없는 새 저장소에는 YAML 색인도 없다. 다른 409는 재시도한다.
      if (!(error instanceof GitHubError && error.emptyRepository)) throw error;
      return {
        repository,
        branch: repo.default_branch,
        commitSha: "",
        tasks: [],
        errors: [],
      };
    }
    const ref = z
      .object({
        object: z.object({ type: z.literal("commit"), sha: shaSchema }),
      })
      .parse(rawRef);
    const commitSha = ref.object.sha;
    // 모든 파일은 같은 커밋에서 읽어 기본 브랜치 이동 중에도 설정을 일관되게 유지한다.
    const entries = z
      .array(entrySchema)
      .parse(
        await this.get(
          `/repos/${repository}/contents/.cloud-pm/tasks?ref=${commitSha}`,
        ),
      );
    if (entries.length >= 1000)
      throw new Error(
        "설정 디렉터리의 완전한 조회를 보장할 수 없습니다. 1000개 미만으로 유지하세요.",
      );
    const tasks = [];
    const errors: { path: string; message: string }[] = [];
    for (const entry of entries) {
      if (entry.type !== "file" || !/\.ya?ml$/i.test(entry.name)) continue;
      const path = `.cloud-pm/tasks/${entry.name}`;
      if (entry.path !== path || entry.name.includes("/"))
        throw new Error("잘못된 설정 파일 경로입니다.");
      try {
        const file = fileSchema.parse(
          await this.get(
            `/repos/${repository}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${commitSha}`,
          ),
        );
        const content = Buffer.from(file.content, "base64");
        if (content.length !== file.size)
          throw new Error("설정 파일 크기가 일치하지 않습니다.");
        tasks.push({
          definition: parseTaskYaml(content.toString("utf8")),
          source: { repository, branch: repo.default_branch, commitSha, path },
        });
      } catch (error) {
        if (error instanceof GitHubRateLimitError) throw error;
        errors.push({ path, message: "설정 파일 조회 또는 YAML 검증 실패" });
      }
    }
    const counts = new Map<string, number>();
    for (const task of tasks)
      counts.set(
        task.definition.task,
        (counts.get(task.definition.task) ?? 0) + 1,
      );
    const validTasks = tasks.filter((task) => {
      if (counts.get(task.definition.task)! > 1) {
        errors.push({
          path: task.source.path,
          message: `중복 태스크 식별자: ${task.definition.task}`,
        });
        return false;
      }
      return true;
    });
    return {
      repository,
      branch: repo.default_branch,
      commitSha,
      tasks: validTasks,
      errors,
    };
  }
}
