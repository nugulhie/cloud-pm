import { z } from "zod";
import type { AIProvider } from "./provider";
import type { GitHubItem, Task } from "../core/model";
const statement = z.object({
  text: z.string().min(1).max(2000),
  sources: z.array(z.string()).min(1).max(20),
});
const schema = z.object({
  summary: z.string().max(4000),
  facts: z.array(statement).max(20),
  interpretations: z.array(statement).max(20),
  unknowns: z.array(z.string().max(1000)).max(20),
});
export async function analyze(
  provider: AIProvider,
  tasks: Task[],
  items: GitHubItem[],
) {
  const selectedTasks = tasks.slice(0, 100),
    selectedItems = items.slice(0, 50);
  const input = {
    tasks: selectedTasks.map((t) => ({ ...t, yaml: undefined })),
    items: selectedItems.map((i) => ({
      ...i,
      body: i.body.slice(0, 3000),
      files: i.files
        ?.slice(0, 20)
        .map((f) => ({ ...f, patch: f.patch?.slice(0, 5000) })),
    })),
  };
  const output = schema.parse(
    await provider.json(
      "PM을 위한 진행 상황과 기술적 변경 영향을 분석한다. {summary:string,facts:[{text,sources}],interpretations:[{text,sources}],unknowns:string[]} 형식. sources는 제공된 task.id 또는 item.id만 사용한다. 사실과 해석을 구분하고 기술적 위험과 다음 확인 사항을 설명한다. diff가 없거나 잘린 내용은 미확인으로 남긴다.",
      input,
    ),
  );
  const ids = new Set([
    ...selectedTasks.map((t) => t.id),
    ...selectedItems.map((i) => i.id),
  ]);
  for (const s of [...output.facts, ...output.interpretations])
    if (s.sources.some((id) => !ids.has(id)))
      throw new Error("AI가 제공 범위 밖의 근거를 참조했습니다.");
  return {
    ...output,
    provider: "anthropic",
    generatedAt: new Date().toISOString(),
    scope: {
      tasks: selectedTasks.map((t) => t.id),
      items: selectedItems.map((i) => ({ id: i.id, updatedAt: i.updatedAt })),
    },
    truncated:
      tasks.length > 100 ||
      items.length > 50 ||
      selectedItems.some(
        (i) =>
          (i.files && i.files.length > 20) ||
          i.body.length > 3000 ||
          i.files?.some((f) => (f.patch?.length ?? 0) > 5000),
      ),
  };
}
export async function suggest(
  provider: AIProvider,
  task: Task,
  items: GitHubItem[],
) {
  const candidates = items.slice(0, 100);
  const output = z
    .object({
      links: z
        .array(
          z.object({ item: z.string(), reason: z.string().min(1).max(2000) }),
        )
        .max(20),
    })
    .parse(
      await provider.json(
        "태스크와 관련된 이슈·PR 연결을 제안한다. 확실한 후보만 {links:[{item:제공된 item.id,reason:연결 근거}]} JSON으로 반환한다. 적절한 후보가 없으면 빈 배열.",
        {
          task: { ...task, yaml: undefined },
          items: candidates.map((i) => ({
            id: i.id,
            title: i.title,
            body: i.body.slice(0, 2000),
          })),
        },
      ),
    );
  const ids = new Set(candidates.map((i) => i.id));
  if (output.links.some((l) => !ids.has(l.item)))
    throw new Error("AI가 제공 범위 밖의 연결을 제안했습니다.");
  return [...new Map(output.links.map((l) => [l.item, l])).values()];
}
