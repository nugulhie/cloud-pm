import { randomBytes, randomUUID } from "node:crypto";
import { getStore } from "../db/store";
import { tokenHash } from "../users/crypto";
if (!process.env.DATABASE_URL)
  throw new Error("운영 DB 연결이 설정된 서버에서 실행하세요.");
const login = process.argv[process.argv.indexOf("--login") + 1];
if (
  !login ||
  !process.argv.includes("--confirm-account-recovery") ||
  !/^[A-Za-z0-9-]{3,39}$/.test(login)
)
  throw new Error("--login <아이디> --confirm-account-recovery를 지정하세요.");
const store = getStore();
try {
  const token = randomBytes(32).toString("base64url");
  await store.transaction(async (tx) => {
    const user = (
        await tx.query<{ id: string }>(
          "SELECT id FROM app_users WHERE lower(login)=lower($1) AND auth_provider<>'github' FOR UPDATE",
          [login],
        )
      )[0],
      owner = (
        await tx.query<{ owner_id: string }>(
          "SELECT owner_id FROM workspace_settings WHERE id='main'",
        )
      )[0];
    if (!user || !owner)
      throw new Error(
        "복구 가능한 비밀번호 계정과 서비스 소유자를 확인하세요.",
      );
    await tx.query(
      "UPDATE password_recoveries SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [user.id],
    );
    await tx.query(
      "INSERT INTO password_recoveries(token_hash,user_id,created_by,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes')",
      [tokenHash(token), user.id, owner.owner_id],
    );
    await tx.save(
      "account-security",
      randomUUID(),
      { action: "operator-recovery-issued", userId: user.id },
      "server-operator",
    );
  });
  console.log(
    "30분 동안 한 번 사용할 복구 코드입니다. 본인 확인 후 계정 소유자에게 전달하세요.\n" +
      token,
  );
} finally {
  await store.close();
}
