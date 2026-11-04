import type { Project } from "./model";
import type { Store } from "../db/store";

// 브라우저와 서버에서 같은 후보를 만든다. 내부 프로젝트 ID와 독립적이다.
export function suggestProjectPrefix(
  name: string,
  seed: string,
  used: Iterable<string> = [],
) {
  const reserved = new Set(Array.from(used, (value) => value.toUpperCase()));
  const stem = name
    .normalize("NFKD")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  for (let attempt = 0; attempt < 1000; attempt++) {
    let hash = 2166136261;
    for (const c of `${seed}:${attempt}`)
      hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
    const suffix = hash.toString(36).toUpperCase().padStart(7, "0").slice(-5);
    const candidate =
      attempt === 0 ? stem.slice(0, 5).padEnd(5, suffix) : suffix;
    if (!reserved.has(candidate)) return candidate;
  }
  throw new Error("사용 가능한 프로젝트 식별자를 생성하지 못했습니다.");
}

// 호출자는 워크스페이스·프로젝트 잠금을 보유한다. 기존 번호와 원본 ID는 유지한다.
export async function ensureProjectPrefixes(store: Store) {
  const projects = await store.list<Project>("project");
  const used = new Set(
    projects.flatMap((row) =>
      row.data.featurePrefix ? [row.data.featurePrefix] : [],
    ),
  );
  for (const row of projects.sort((a, b) =>
    a.data.id.localeCompare(b.data.id),
  )) {
    if (row.data.featurePrefix) continue;
    const featurePrefix = suggestProjectPrefix(
      row.data.name,
      row.data.id,
      used,
    );
    await store.save(
      "project",
      row.data.id,
      { ...row.data, featurePrefix },
      "system-project-prefix",
      row.revision,
    );
    used.add(featurePrefix);
  }
}
