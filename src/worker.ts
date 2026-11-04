import { getStore } from "./db/store";
import { GitHubChanges } from "./github/changes";
import { serverGitHubClient } from "./github/server-client";
import { processNextJob } from "./jobs/worker";
import { setTimeout } from "node:timers/promises";
import { demoMode } from "./core/auth";

if (!process.env.DATABASE_URL) {
  console.error(
    "독립 작업자는 웹과 DB를 공유할 수 있도록 DATABASE_URL이 필요합니다.",
  );
  process.exitCode = 1;
} else if (!process.env.GITHUB_ORG) {
  console.error("GITHUB_ORG를 설정하세요.");
  process.exitCode = 1;
} else if (demoMode()) {
  console.error("데모 모드에서는 작업자를 실행하지 않습니다.");
  process.exitCode = 1;
} else {
  const store = getStore();
  const changes = new GitHubChanges(store, serverGitHubClient(undefined, true));
  const once = process.argv.includes("--once");
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    await changes.bootstrap();
    do {
      const result = await processNextJob(store, (_repository, job) =>
        changes.process(job),
      );
      if (result) console.log(JSON.stringify(result));
      if (once && result && result.status !== "completed") process.exitCode = 2;
      if (!result && !once && !stopping) await setTimeout(2000);
    } while (!stopping && !once);
  } catch {
    console.error("작업자 실행에 실패했습니다. DB 연결을 확인하세요.");
    process.exitCode = 1;
  } finally {
    await store.close();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
