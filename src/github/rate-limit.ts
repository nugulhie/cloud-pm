import { createHash } from "node:crypto";
import { DomainError } from "../core/model";

export class GitHubRateLimitError extends DomainError {
  constructor(public readonly retryAt: number) {
    super(
      `GitHub API 요청 한도에 도달했습니다. ${new Date(retryAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 이후 다시 처리합니다.`,
      429,
    );
  }
}
type Budget = { blockedUntil: number; remaining?: number; reset?: number };
const state = globalThis as typeof globalThis & {
  githubBudgets?: Map<string, Budget>;
};
const budgets = (state.githubBudgets ??= new Map<string, Budget>());
export function installationRateKey() {
  return `app:${process.env.GITHUB_APP_ID}:${process.env.GITHUB_APP_INSTALLATION_ID ?? process.env.GITHUB_ORG}`;
}
export function tokenRateKey(token?: string) {
  return token
    ? `token:${createHash("sha256").update(token).digest("hex")}`
    : undefined;
}
export function checkGitHubBudget(key?: string, reserve = 0) {
  const budget = key && budgets.get(key);
  if (!budget) return;
  const now = Date.now();
  if (budget.blockedUntil > now)
    throw new GitHubRateLimitError(budget.blockedUntil);
  if (
    budget.reset &&
    budget.reset > now &&
    budget.remaining !== undefined &&
    budget.remaining <= reserve
  )
    throw new GitHubRateLimitError(budget.reset);
}
export async function observeGitHubBudget(response: Response, key?: string) {
  const now = Date.now();
  const remainingHeader = response.headers.get("x-ratelimit-remaining");
  const resetHeader = response.headers.get("x-ratelimit-reset");
  const remaining =
    remainingHeader === null ? undefined : Number(remainingHeader);
  const reset =
    resetHeader === null ? undefined : Number(resetHeader) * 1000 + 1000;
  let message = "";
  if ([403, 429].includes(response.status)) {
    try {
      message = String((await response.clone().json()).message ?? "");
    } catch {}
  }
  const limited =
    response.status === 429 ||
    ([403].includes(response.status) &&
      (remaining === 0 ||
        response.headers.has("retry-after") ||
        /rate limit|abuse detection/i.test(message)));
  const retry = response.headers.get("retry-after");
  const retryAt = retry
    ? /^\d+(\.\d+)?$/.test(retry)
      ? now + Number(retry) * 1000
      : Date.parse(retry)
    : undefined;
  const until = limited
    ? Math.max(
        now + 60000,
        Number.isFinite(retryAt) ? retryAt! : 0,
        remaining === 0 && Number.isFinite(reset) ? reset! : 0,
      )
    : 0;
  if (key) {
    if (budgets.size >= 1000 && !budgets.has(key))
      budgets.delete(budgets.keys().next().value!);
    const previous = budgets.get(key);
    budgets.set(key, {
      blockedUntil: Math.max(previous?.blockedUntil ?? 0, until),
      remaining: Number.isFinite(remaining) ? remaining : previous?.remaining,
      reset: Number.isFinite(reset) ? reset : previous?.reset,
    });
  }
  if (limited) throw new GitHubRateLimitError(until);
}
