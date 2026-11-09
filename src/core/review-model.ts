import { z } from "zod";
import { id } from "./model";
export type ChangeTarget = {
  recordRevision?: number;
  kind: "requirement" | "task";
  id: string;
  title: string;
  revision: number;
  reviewerId: string | null;
  status: "pending" | "reviewed" | "applied";
  note: string;
  reviewedBy?: string;
  reviewedAt?: string;
};
export type ChangeReview = {
  id: string;
  project: string;
  sourceKind: "knowledge" | "requirement";
  sourceId: string;
  sourceRevision: number;
  title: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  targets: ChangeTarget[];
  createdAt: string;
  author: string;
};
export type ChangeReviewRecord = Omit<ChangeReview, "targets">;
export type ChangeTargetRecord = {
  id: string;
  review: string;
  project: string;
  target: ChangeTarget;
};
export type TaskReview = {
  id: string;
  project: string;
  task: string;
  taskRevision: number;
  reviewerId: string;
  status: "pending" | "approved" | "rejected";
  requestedBy: string;
  requestedById?: string;
  requestedAt: string;
  note: string;
  decidedBy?: string;
  decidedAt?: string;
};
export const milestoneInput = z.strictObject({
  id,
  project: id,
  name: z.string().trim().min(1).max(200),
  targetDate: z.iso.date(),
  taskIds: z.array(id).max(500),
  description: z.string().max(4000).default(""),
  revision: z.number().int().positive().optional(),
});
export type Milestone = Omit<z.infer<typeof milestoneInput>, "revision">;
export const releaseInput = z.strictObject({
  id,
  project: id,
  version: z.string().trim().min(1).max(100),
  plannedDate: z.iso.date(),
  actualDate: z.iso.date().nullable().default(null),
  taskIds: z.array(id).max(500),
  milestoneId: id.nullable().default(null),
  environment: z.string().max(100).default("production"),
  url: z
    .string()
    .max(2000)
    .default("")
    .refine(
      (s) => !s || /^https?:\/\//.test(s),
      "http 또는 https 주소를 입력하세요.",
    ),
  notes: z.string().max(8000).default(""),
  status: z.enum(["planned", "released"]).default("planned"),
  revision: z.number().int().positive().optional(),
});
export type Release = Omit<z.infer<typeof releaseInput>, "revision">;
