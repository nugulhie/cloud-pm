import { z } from "zod";
import { id } from "./model";
export const knowledgeInput = z.strictObject({
  id,
  kind: z.enum(["policy", "glossary"]),
  name: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(12000),
  category: z.string().trim().max(100).default(""),
  aliases: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  owner: z.string().trim().max(100).default(""),
  remarks: z.string().max(2000).default(""),
  status: z.enum(["draft", "active", "deprecated"]).default("draft"),
});
export type KnowledgeEntry = z.infer<typeof knowledgeInput> & {
  editor: string;
};
export const knowledgeStates = {
  draft: "초안",
  active: "사용 중",
  deprecated: "사용 중단",
} as const;
