import { Users } from "../users/service";
import { getStore } from "../db/store";
import { demoMode } from "./auth";
import { Service } from "./service";
import { seedDemo } from "./demo";
const runtime = globalThis as typeof globalThis & {
  pmDemoSeed?: Promise<void>;
};
export async function serviceFor(request: Request) {
  const store = getStore();
  const { actor } = await new Users(store).resolve(request);
  if (demoMode()) {
    runtime.pmDemoSeed ??= seedDemo(store);
    await runtime.pmDemoSeed;
  }
  return new Service(store, actor);
}
