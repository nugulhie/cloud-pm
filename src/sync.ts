import { getStore } from "./db/store";
import { Service } from "./core/service";
const store = getStore();
try {
  const report = await new Service(store, {
    name: "manual-sync",
    role: "write",
  }).sync();
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length) process.exitCode = 2;
} catch (error) {
  console.error(error instanceof Error ? error.message : "동기화 실패");
  process.exitCode = 1;
} finally {
  await store.close();
}
