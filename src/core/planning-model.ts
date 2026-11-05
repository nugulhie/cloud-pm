import { z } from "zod";
import { id, taskSchema } from "./model";
export const planningPage = {
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
};
export const taskFilters = z.strictObject({
  project: id.optional(),
  assigneeUserId: z
    .union([z.string().uuid(), z.enum(["me", "unassigned"])])
    .optional(),
  assignee: z.string().max(100).optional(),
  statuses: z.array(taskSchema.shape.status).max(6).optional(),
  types: z
    .array(z.enum(["feature", "bug", "improvement", "operations"]))
    .max(4)
    .optional(),
  priorities: z.array(taskSchema.shape.priority).max(3).optional(),
  query: z.string().max(300).optional(),
  blockedOnly: z.boolean().optional(),
  sprintId: id.optional(),
  dueBefore: z.iso.date().optional(),
  dueAfter: z.iso.date().optional(),
  view: z.enum(["hierarchy", "list", "board"]).optional(),
});
export type TaskFilters = z.infer<typeof taskFilters>;
export const savedViewInput = z.strictObject({
  id,
  name: z.string().trim().min(1).max(100),
  visibility: z.enum(["private", "workspace"]),
  filters: taskFilters,
  revision: z.number().int().min(0).default(0),
});
export type SavedView = Omit<z.infer<typeof savedViewInput>, "revision"> & {
  ownerId: string;
};
export const capacityInput = z.strictObject({
  userId: z.string().uuid(),
  hoursPerDay: z.number().min(0).max(24).default(8),
  weekdays: z
    .array(z.number().int().min(0).max(6))
    .max(7)
    .default([1, 2, 3, 4, 5]),
  exceptions: z
    .record(z.iso.date(), z.number().min(0).max(24))
    .refine((v) => Object.keys(v).length <= 366)
    .default({}),
  revision: z.number().int().min(0).default(0),
});
export type Capacity = Omit<z.infer<typeof capacityInput>, "revision">;
export const sprintInput = z.strictObject({
  id,
  project: id,
  name: z.string().trim().min(1).max(100),
  goal: z.string().max(2000).default(""),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  revision: z.number().int().min(0).default(0),
});
export type Sprint = Omit<z.infer<typeof sprintInput>, "revision"> & {
  status: "planned" | "active" | "closed";
  startedAt?: string;
  closedAt?: string;
  initialTaskIds?: string[];
  closure?: {
    done: string[];
    canceled: string[];
    incomplete: string[];
    estimatedHours: number;
    storyPoints: number;
  };
};
export const assignmentInput = z.strictObject({
  sourceName: z.string().trim().min(1).max(100),
  userId: z.string().uuid(),
  revision: z.number().int().min(0).default(0),
});
export type Assignment = { id: string; sourceName: string; userId: string };
export type PlanningPerson = {
  id: string;
  login: string;
  displayName: string;
  githubLogin: string | null;
  githubId: string | null;
  role: string;
};
export const normalizedAssignee = (name: string) =>
  name.trim().normalize("NFC").toLowerCase().replace(/^@/, "");
