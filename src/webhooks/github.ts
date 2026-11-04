import { normalizeGitHubChange } from "./change";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { DomainError } from "../core/model";
import { SyncQueue } from "../jobs/queue";

export function verifySignature(
  body: Uint8Array,
  signature: string | null,
  secret: string,
) {
  if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}
const supported = new Set([
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "issues",
  "issue_comment",
  "push",
  "check_run",
  "check_suite",
  "status",
  "repository",
]);
const maxBytes = 1024 * 1024;
async function readBody(request: Request) {
  const length = request.headers.get("content-length");
  if (length && Number(length) > maxBytes)
    throw new DomainError("웹훅 크기 제한을 초과했습니다.", 413);
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new DomainError("웹훅 크기 제한을 초과했습니다.", 413);
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(parts);
}
export async function receiveGithubWebhook(
  request: Request,
  queue: SyncQueue,
  options: {
    secret?: string;
    appSecret?: string;
    appInstallationId?: string;
    onAppInstallationChanged?: () => void;
    organization?: string;
    disabled?: boolean;
  },
) {
  if (options.disabled)
    throw new DomainError("데모 모드에서는 웹훅을 처리하지 않습니다.", 403);
  if ((!options.secret && !options.appSecret) || !options.organization)
    throw new DomainError("웹훅 비밀키와 조직 설정이 필요합니다.", 503);
  const raw = await readBody(request);
  const signature = request.headers.get("x-hub-signature-256");
  const legacySignature =
    !!options.secret && verifySignature(raw, signature, options.secret);
  const appSignature =
    !!options.appSecret && verifySignature(raw, signature, options.appSecret);
  if (!legacySignature && !appSignature)
    throw new DomainError("웹훅 서명이 일치하지 않습니다.", 401);
  let body: unknown;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new DomainError("유효한 JSON이 아닙니다.");
  }
  const delivery = z
    .string()
    .uuid()
    .parse(request.headers.get("x-github-delivery"));
  const event = z
    .string()
    .regex(/^[a-z_]+$/)
    .parse(request.headers.get("x-github-event"));
  if (event === "ping")
    return { status: 200, body: { accepted: true, ping: true } };
  if (appSignature && !legacySignature) {
    const installation = z
      .object({ installation: z.object({ id: z.number().int().positive() }) })
      .safeParse(body);
    if (
      !installation.success ||
      (options.appInstallationId &&
        String(installation.data.installation.id) !== options.appInstallationId)
    )
      throw new DomainError("설정한 GitHub App 설치의 이벤트가 아닙니다.", 403);
  }
  if (
    appSignature &&
    ["installation", "installation_repositories"].includes(event)
  ) {
    const installation = z
      .object({
        installation: z.object({ account: z.object({ login: z.string() }) }),
      })
      .parse(body);
    if (
      installation.installation.account.login.toLowerCase() !==
      options.organization.toLowerCase()
    )
      throw new DomainError("허용한 조직의 이벤트가 아닙니다.", 403);
    options.onAppInstallationChanged?.();
    return { status: 202, body: { accepted: true, installationChanged: true } };
  }
  if (!supported.has(event))
    return { status: 200, body: { accepted: false, ignored: true } };
  const payload = z
    .object({
      repository: z.object({
        full_name: z
          .string()
          .regex(/^[A-Za-z0-9_-]+\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/),
      }),
    })
    .parse(body);
  const repository = payload.repository.full_name.toLowerCase();
  if (repository.split("/")[0] !== options.organization.toLowerCase())
    throw new DomainError("허용한 조직의 이벤트가 아닙니다.", 403);
  const created = await queue.enqueue(
    delivery,
    event,
    repository,
    normalizeGitHubChange(event, body, repository),
  );
  return {
    status: 202,
    body: { accepted: true, duplicate: !created, delivery },
  };
}
