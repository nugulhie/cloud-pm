import { z } from "zod";
import { receiveGithubWebhook } from "../../../../webhooks/github";
import { SyncQueue } from "../../../../jobs/queue";
import { getStore } from "../../../../db/store";
import { DomainError } from "../../../../core/model";
import { demoMode } from "../../../../core/auth";
import { configuredGitHubApp } from "../../../../github/app";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const result = await receiveGithubWebhook(
      request,
      new SyncQueue(getStore()),
      {
        secret: process.env.GITHUB_WEBHOOK_SECRET,
        appSecret: process.env.GITHUB_APP_WEBHOOK_SECRET,
        appInstallationId: process.env.GITHUB_APP_INSTALLATION_ID,
        onAppInstallationChanged: () => configuredGitHubApp()?.invalidate(),
        organization: process.env.GITHUB_ORG,
        disabled: demoMode(),
      },
    );
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof DomainError
            ? error.message
            : error instanceof z.ZodError
              ? "웹훅 형식을 확인하세요."
              : "웹훅 저장에 실패했습니다.",
      },
      {
        status:
          error instanceof DomainError
            ? error.status
            : error instanceof z.ZodError
              ? 400
              : 500,
      },
    );
  }
}
