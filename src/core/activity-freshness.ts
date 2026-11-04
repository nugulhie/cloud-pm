import type { GitHubItem, Stored } from "./model";

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function newestActivities(items: Stored<GitHubItem>[]) {
  return [...items].sort(
    (a, b) =>
      timestamp(b.data.updatedAt) - timestamp(a.data.updatedAt) ||
      a.data.id.localeCompare(b.data.id),
  );
}

export function activityFreshness(items: Stored<GitHubItem>[]) {
  const newest = (values: string[]) =>
    values.reduce<string | null>(
      (latest, value) =>
        timestamp(value) > timestamp(latest ?? "") ? value : latest,
      null,
    );
  return {
    collectedAt: newest(items.map((row) => row.updatedAt)),
    sourceUpdatedAt: newest(items.map((row) => row.data.updatedAt)),
  };
}
