import type { GitHubItem, Stored } from "./model";
import type { Link } from "./service";

export function taskGitHubConnections(
  links: Stored<Link>[],
  items: Stored<GitHubItem>[],
) {
  const byItem = new Map(items.map((row) => [row.data.id, row.data]));
  const result = new Map<string, GitHubItem[]>();
  for (const { data: link } of links) {
    if (link.status !== "approved") continue;
    const item = byItem.get(link.item);
    if (!item) continue;
    const connected = result.get(link.task) ?? [];
    if (!connected.some((candidate) => candidate.id === item.id))
      connected.push(item);
    result.set(link.task, connected);
  }
  return result;
}
