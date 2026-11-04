import { installationRateKey } from "./rate-limit";
import type { Actor } from "../core/model";
import { GitHubClient } from "./client";
import { configuredGitHubApp } from "./app";

export function serverGitHubClient(actor?: Actor, background = false) {
  const budget = { reserve: background ? 200 : 0 };
  if (actor?.githubTokenProvider)
    return new GitHubClient({
      tokenProvider: actor.githubTokenProvider,
      installationScoped: true,
      rateKey: installationRateKey(),
      ...budget,
    });
  if (actor?.userId || actor?.githubToken)
    return new GitHubClient({ token: actor.githubToken, ...budget });
  const app = configuredGitHubApp();
  return app
    ? new GitHubClient({
        tokenProvider: app.token,
        installationScoped: true,
        rateKey: installationRateKey(),
        ...budget,
      })
    : new GitHubClient({
        token: actor?.githubToken ?? process.env.GITHUB_TOKEN,
        ...budget,
      });
}
