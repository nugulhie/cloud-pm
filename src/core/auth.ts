import { timingSafeEqual } from "node:crypto";
import { DomainError, type Actor } from "./model";
export function demoMode() {
  return (
    process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production"
  );
}
function matches(a: string, b: string | undefined) {
  return (
    !!b &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export function assertOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const requestUrl = new URL(request.url);
  const allowed = new URL(
    process.env.APP_URL ??
      `${requestUrl.protocol}//${request.headers.get("host") ?? requestUrl.host}`,
  ).origin;
  if (origin && origin !== allowed)
    throw new DomainError("허용되지 않은 요청 출처입니다.", 403);
}
export function authenticate(request: Request): Actor {
  assertOrigin(request);
  if (demoMode()) return { name: "demo", role: "write" };
  const token =
    request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (matches(token, process.env.APP_WRITE_TOKEN))
    return { name: "workspace-editor", role: "write" };
  if (matches(token, process.env.APP_READ_TOKEN))
    return { name: "workspace-reader", role: "read" };
  throw new DomainError("접근 토큰이 필요합니다.", 401);
}
export function requireWrite(actor: Actor) {
  if (actor.role !== "write")
    throw new DomainError("수정 권한이 필요합니다.", 403);
}
