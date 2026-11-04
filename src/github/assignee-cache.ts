import { createHash } from "node:crypto";
import type { GitHubClient } from "./client";
type Users = Awaited<ReturnType<GitHubClient["listAssignees"]>>;
const cache = new Map<string, { expires: number; value: Promise<Users> }>();
export function repositoryAssignees(
  client: GitHubClient,
  repository: string,
  credential?: string,
) {
  if (!credential) return client.listAssignees(repository);
  const key = createHash("sha256")
    .update(credential)
    .update("\0")
    .update(repository)
    .digest("hex");
  const found = cache.get(key);
  if (found && found.expires > Date.now()) return found.value;
  if (cache.size >= 300) cache.delete(cache.keys().next().value!);
  const value = client.listAssignees(repository).catch((error) => {
    if (cache.get(key)?.value === value) cache.delete(key);
    throw error;
  });
  cache.set(key, { expires: Date.now() + 60000, value });
  return value;
}
