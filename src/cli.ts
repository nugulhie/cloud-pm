import { serverGitHubClient } from "./github/server-client";
import { evaluateRepository } from "./github/evaluate";

const args = process.argv.slice(2);
if (args.length !== 1 || !args[0]) {
  console.error("사용법: npm run evaluate -- <owner/repository>");
  process.exitCode = 1;
} else {
  try {
    const report = await evaluateRepository(args[0], serverGitHubClient());
    console.log(JSON.stringify(report, null, 2));
    if (
      report.errors.length ||
      report.evaluations.some((task) => task.state === "unknown")
    )
      process.exitCode = 2;
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "평가 중 오류가 발생했습니다.",
    );
    process.exitCode = 1;
  }
}
