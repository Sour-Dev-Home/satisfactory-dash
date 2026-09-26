import { z } from "zod";
import { ServerIdSchema } from "./ids";

/** ADR-0001: the frontend discovers servers here and auto-selects when there's one. */
export const ServerSummarySchema = z.object({
  id: ServerIdSchema,
  displayName: z.string().describe("Operator-configured name. Never a host or port."),
  // ADR-0027 PR 7b (additive and optional per the deploy-skew rule: an older backend, and the no-database path, omit it).
  role: z
    .string()
    .optional()
    .describe(
      "The signed-in user's membership role on this server. Known: owner, admin, viewer. UX only (to show or hide " +
        "edit controls); the backend enforces it. Absent or unknown means treat as read-only.",
    ),
});

export const ServerListResponseSchema = z.object({
  servers: z.array(ServerSummarySchema),
  // ADR-0030 (additive and optional per the deploy-skew rule: an older backend omits it).
  canManageServers: z
    .boolean()
    .optional()
    .describe("True only for the operator: whether to offer adding, editing and removing servers."),
});

export type ServerSummary = z.infer<typeof ServerSummarySchema>;
export type ServerListResponse = z.infer<typeof ServerListResponseSchema>;
