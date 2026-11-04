import { randomUUID } from "node:crypto";
import { Store } from "../db/store";
import { DomainError } from "../core/model";

// 프로세스가 종료돼도 임대가 만료되면 다음 동기화가 이어받을 수 있다.
export async function acquireSyncLease(store: Store) {
  const token = randomUUID();
  const rows = await store.query(
    `INSERT INTO sync_leases(name,token,expires_at) VALUES('github-sync',$1,now()+interval '90 seconds') ON CONFLICT(name) DO UPDATE SET token=$1,expires_at=now()+interval '90 seconds' WHERE sync_leases.expires_at<now() RETURNING token`,
    [token],
  );
  if (!rows.length) throw new DomainError("다른 동기화가 실행 중입니다.", 409);
  let lost = false;
  const renew = async () => {
    try {
      const rows = await store.query(
        `UPDATE sync_leases SET expires_at=now()+interval '90 seconds' WHERE name='github-sync' AND token=$1 AND expires_at>now() RETURNING token`,
        [token],
      );
      if (!rows.length) lost = true;
    } catch {
      lost = true;
    }
  };
  const timer = setInterval(() => {
    void renew();
  }, 20000);
  timer.unref();
  return {
    async check() {
      if (lost) throw new DomainError("동기화 임대가 만료되었습니다.", 409);
      const rows = await store.query(
        `SELECT token FROM sync_leases WHERE name='github-sync' AND token=$1 AND expires_at>now()`,
        [token],
      );
      if (!rows.length)
        throw new DomainError("동기화 임대가 만료되었습니다.", 409);
    },
    async close() {
      clearInterval(timer);
      await store.query(
        `DELETE FROM sync_leases WHERE name='github-sync' AND token=$1`,
        [token],
      );
    },
  };
}
