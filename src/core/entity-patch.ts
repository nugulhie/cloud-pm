import { z } from "zod";
import { id, projectSchema, taskSchema } from "./model";
import { requirementInput } from "./requirement-model";
import { knowledgeInput } from "./knowledge-model";

// Creation defaults must never fill omitted patch fields (Zod 4 partial keeps them).
function patchSchema(schema: { shape: Record<string, z.ZodType> }) {
  return z.strictObject(
    Object.fromEntries(
      Object.entries(schema.shape).map(([key, field]) => [
        key,
        z.optional(
          field instanceof z.ZodDefault ? field.removeDefault() : field,
        ),
      ]),
    ),
  );
}
export const entityPatchSchemas = {
  project: patchSchema(projectSchema.omit({ id: true })),
  task: patchSchema(
    taskSchema.omit({ id: true, project: true, feature: true }),
  ),
  requirement: patchSchema(requirementInput.omit({ id: true, project: true })),
  knowledge: patchSchema(knowledgeInput.omit({ id: true, kind: true })),
};
const identity = { id, revision: z.number().int().positive() };
export const entityPatchInput = z
  .discriminatedUnion("kind", [
    z.strictObject({
      ...identity,
      kind: z.literal("project"),
      patch: entityPatchSchemas.project,
    }),
    z.strictObject({
      ...identity,
      kind: z.literal("task"),
      patch: entityPatchSchemas.task,
    }),
    z.strictObject({
      ...identity,
      kind: z.literal("requirement"),
      patch: entityPatchSchemas.requirement,
    }),
    z.strictObject({
      ...identity,
      kind: z.literal("knowledge"),
      patch: entityPatchSchemas.knowledge,
    }),
  ])
  .refine(
    (value) => Object.keys(value.patch).length > 0,
    "변경할 필드를 하나 이상 지정하세요.",
  );

export function inputFields<T extends object>(
  schema: { shape: Record<string, unknown> },
  value: T,
) {
  return Object.fromEntries(
    Object.keys(schema.shape)
      .filter((key) => key in value)
      .map((key) => [key, (value as Record<string, unknown>)[key]]),
  );
}
