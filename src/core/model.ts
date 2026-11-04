import { z } from "zod";
export const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const projectSchema = z.strictObject({
  id,
  name: z.string().min(1).max(200),
  featurePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{5}$/)
    .optional(),
  goal: z.string().max(4000),
  startDate: z.iso.date().nullable().optional(),
  endDate: z.iso.date().nullable().optional(),
  repositories: z
    .array(z.string().regex(/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/))
    .min(0)
    .max(100),
});
export const taskTypes = {
  feature: "기능 개발",
  bug: "버그",
  improvement: "개선",
  operations: "운영",
} as const;
export const featureSchema = z.strictObject({
  id,
  project: id,
  name: z.string().min(1).max(200),
  goal: z.string().max(4000),
  acceptanceCriteria: z.string().max(8000).optional(),
});
export const taskSchema = z.strictObject({
  id,
  project: id,
  feature: id.or(z.literal("")).default(""),
  title: z.string().min(1).max(300),
  type: z.enum(["feature", "bug", "improvement", "operations"]).optional(),
  parentId: id.nullable().optional(),
  dependsOn: z.array(id).max(100).optional(),
  description: z.string().max(8000).default(""),
  assignee: z.string().max(100).default(""),
  status: z
    .enum(["backlog", "ready", "in_progress", "in_review", "done", "canceled"])
    .default("backlog"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  dueDate: z.iso.date().nullable().default(null),
  blockedReason: z.string().max(2000).default(""),
  yaml: z.string().max(65536).default(""),
});
export type Project = z.infer<typeof projectSchema>;
export type Feature = z.infer<typeof featureSchema>;
export type Task = z.infer<typeof taskSchema>;
export interface GitHubItem {
  id: string;
  repository: string;
  number: number;
  kind: "pr" | "issue";
  title: string;
  body: string;
  author: string;
  assignees: string[];
  reviewers: string[];
  reviewerTeams?: string[];
  labels?: { name: string; color: string }[];
  state: string;
  url: string;
  updatedAt: string;
  files?: {
    path: string;
    previousPath?: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  }[];
  filesComplete?: boolean;
  headSha?: string;
  filesHeadSha?: string;
  ciHeadSha?: string;
  baseBranch?: string;
  mergedAt?: string | null;
  commitAuthors?: string[];
  ci?: { state: "success" | "failure" | "pending" | "unknown"; url: string };
}
export interface Stored<T> {
  data: T;
  revision: number;
  updatedAt: string;
}
export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";
export interface Actor {
  name: string;
  role: "read" | "write";
  userId?: string;
  workspaceId?: string;
  workspaceRole?: WorkspaceRole;
  admin?: boolean;
  repositories?: string[];
  githubToken?: string;
  githubTokenProvider?: () => Promise<string>;
}
export class DomainError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
