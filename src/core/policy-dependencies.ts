import { DomainError, type Stored } from "./model";
import type { KnowledgeEntry } from "./knowledge-model";

export type PolicyRef = { id: string; name: string };
export function policyGraph(rows: Stored<KnowledgeEntry>[]) {
  const policies = new Map(
    rows.filter((r) => r.data.kind === "policy").map((r) => [r.data.id, r]),
  );
  const reverse = new Map<string, string[]>();
  for (const row of policies.values()) {
    for (const dependency of new Set(row.data.dependsOn ?? [])) {
      if (!policies.has(dependency)) continue;
      const dependents = reverse.get(dependency) ?? [];
      dependents.push(row.data.id);
      reverse.set(dependency, dependents);
    }
  }
  return { policies, reverse };
}
export type PolicyGraph = ReturnType<typeof policyGraph>;
export function policyDependents(graph: PolicyGraph, root: string) {
  const found = new Map<string, { next: string | null; distance: number }>();
  if (!graph.policies.has(root)) return found;
  found.set(root, { next: null, distance: 0 });
  const queue = [root];
  for (let offset = 0; offset < queue.length; offset++) {
    const current = queue[offset]!;
    for (const dependent of graph.reverse.get(current) ?? []) {
      if (found.has(dependent)) continue;
      found.set(dependent, {
        next: current,
        distance: found.get(current)!.distance + 1,
      });
      queue.push(dependent);
    }
  }
  return found;
}
export function policyPath(
  graph: PolicyGraph,
  found: ReturnType<typeof policyDependents>,
  from: string,
  root: string,
) {
  const path: PolicyRef[] = [];
  let current: string | null = from;
  while (current && path.length < 7) {
    const row = graph.policies.get(current);
    if (!row) break;
    path.push({ id: current, name: row.data.name });
    current = found.get(current)?.next ?? null;
  }
  const truncated = !!current && current !== root;
  if (current && graph.policies.has(root))
    path.push({ id: root, name: graph.policies.get(root)!.data.name });
  return {
    policyPath: path,
    policyDistance: found.get(from)?.distance ?? 0,
    policyPathTruncated: truncated,
  };
}
export function validatePolicyDependencies(
  value: Pick<KnowledgeEntry, "id" | "kind">,
  dependencies: string[],
  rows: Stored<KnowledgeEntry>[],
) {
  const unique = [...new Set(dependencies)];
  if (value.kind !== "policy" && unique.length)
    throw new DomainError("정책끼리만 의존관계를 등록할 수 있습니다.");
  const graph = policyGraph(rows);
  for (const target of unique) {
    if (target === value.id)
      throw new DomainError("정책은 자기 자신을 참조할 수 없습니다.");
    if (!graph.policies.has(target))
      throw new DomainError("현재 워크스페이스의 정책만 연결할 수 있습니다.");
  }
  const visited = new Set<string>(),
    pending = [...unique];
  while (pending.length) {
    const current = pending.pop()!;
    if (current === value.id)
      throw new DomainError(
        "정책 의존관계가 순환합니다. 연결 방향을 확인하세요.",
      );
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of graph.policies.get(current)?.data.dependsOn ?? [])
      pending.push(next);
  }
  return unique;
}
