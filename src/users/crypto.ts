import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { DomainError } from "../core/model";
const derive = promisify(scrypt);
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await derive(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
export async function checkPassword(password: string, hash: string) {
  const [salt, hex] = hash.split(":");
  if (!salt || !hex) return false;
  const key = (await derive(password, salt, 64)) as Buffer;
  const stored = Buffer.from(hex, "hex");
  return stored.length === key.length && timingSafeEqual(key, stored);
}
function encryptionKey() {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key))
    throw new DomainError("서버 토큰 암호화 키 설정이 필요합니다.", 503);
  return Buffer.from(key, "hex");
}
export function encryptToken(token: string) {
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [nonce, cipher.getAuthTag(), data]
    .map((b) => b.toString("base64url"))
    .join(".");
}
export function decryptToken(encrypted: string) {
  const [n, t, c] = encrypted.split(".");
  if (!n || !t || !c) throw new Error("잘못된 암호문");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(n, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(t, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(c, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
