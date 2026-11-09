import { randomUUID, createHash } from "node:crypto";
import type { Store } from "../db/store";
import type { Actor, Stored, Task } from "./model";
import type { Requirement } from "./requirement-model";
import { requirementTaskIds } from "./requirement-model";
import type { KnowledgeEntry } from "./knowledge-model";
import { policyGraph, policyDependents } from "./policy-dependencies";
import type { ChangeReview, ChangeTarget } from "./review-model";
export const changeTargetId = (review: string, kind: string, target: string) =>
  createHash("sha256").update(`${review}:${kind}:${target}`).digest("hex");

export async function captureDocumentChange(
  store: Store,
  actor: Actor,
  kind: "knowledge" | "requirement",
  before: Stored<any> | undefined,
  after: Stored<any> | undefined,
) {
  if (!before || !after) return;
  const watched =
    kind === "knowledge"
      ? ["name", "content", "status", "dependsOn"]
      : [
          "featureName",
          "description",
          "policy",
          "policyIds",
          "glossaryIds",
          "remarks",
        ];
  if (
    watched.every(
      (key) =>
        JSON.stringify(before.data[key]) === JSON.stringify(after.data[key]),
    )
  )
    return;
  const previous = Object.fromEntries(
      watched.map((k) => [k, before.data[k] ?? null]),
    ),
    next = Object.fromEntries(watched.map((k) => [k, after.data[k] ?? null]));
  const requirements = await store.list<Requirement>("requirement"),
    tasks = await store.list<Task>("task");
  let affected = requirements.filter(
    (r) => r.data.id === after.data.id && kind === "requirement",
  );
  if (kind === "knowledge") {
    const docs = await store.list<KnowledgeEntry>("knowledge");
    const graph = policyGraph(docs),
      previousGraph = policyGraph(
        docs.map((r) => (r.data.id === before.data.id ? before : r)),
      );
    const ids = new Set([
      after.data.id,
      ...policyDependents(graph, after.data.id).keys(),
      ...policyDependents(previousGraph, after.data.id).keys(),
    ]);
    affected = requirements.filter((r) =>
      [...(r.data.policyIds ?? []), ...(r.data.glossaryIds ?? [])].some((id) =>
        ids.has(id),
      ),
    );
  }
  const projects = new Set(affected.map((r) => r.data.project));
  for (const project of projects) {
    const prds = affected.filter((r) => r.data.project === project),
      taskIds = new Set(prds.flatMap((r) => requirementTaskIds(r.data)));
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of tasks)
        if (
          t.data.project === project &&
          t.data.parentId &&
          taskIds.has(t.data.parentId) &&
          !taskIds.has(t.data.id)
        ) {
          taskIds.add(t.data.id);
          changed = true;
        }
    }
    const targets: ChangeTarget[] = [
      ...prds.map((r) => ({
        kind: "requirement" as const,
        id: r.data.id,
        title: r.data.featureName,
        revision: r.revision,
        reviewerId: actor.userId ?? null,
        status: "pending" as const,
        note: "",
      })),
      ...tasks
        .filter((t) => t.data.project === project && taskIds.has(t.data.id))
        .map((r) => ({
          kind: "task" as const,
          id: r.data.id,
          title: r.data.title,
          revision: r.revision,
          reviewerId: r.data.assigneeUserId ?? actor.userId ?? null,
          status: "pending" as const,
          note: "",
        })),
    ];
    const entry: ChangeReview = {
      id: randomUUID(),
      project,
      sourceKind: kind,
      sourceId: after.data.id,
      sourceRevision: after.revision,
      title: after.data.name ?? after.data.featureName,
      before: previous,
      after: next,
      targets,
      createdAt: new Date().toISOString(),
      author: actor.name,
    };
    const { targets: captured, ...metadata } = entry;
    await store.save("change-review", entry.id, metadata, actor.name);
    const values = captured.map((target) => {
      const id = changeTargetId(entry.id, target.kind, target.id);
      return { id, data: { id, review: entry.id, project, target } };
    });
    if (values.length)
      await store.query(
        `WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id text,data jsonb)), changed AS (INSERT INTO records(workspace_id,kind,id,data) SELECT $2,'change-target',id,data FROM incoming RETURNING *) INSERT INTO events(id,kind,entity_id,actor,workspace_id,data) SELECT $3||'-'||row_number() OVER(),kind,id,$4,workspace_id,jsonb_build_object('revision',revision,'value',data) FROM changed`,
        [JSON.stringify(values), store.workspaceId, randomUUID(), actor.name],
      );
  }
}
