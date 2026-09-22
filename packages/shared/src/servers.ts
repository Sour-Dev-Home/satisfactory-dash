import { z } from "zod";
import { ServerIdSchema } from "./ids";

/** ADR-0001: the frontend discovers servers here and auto-selects when there's one. */
export const ServerSummarySchema = z.object({
  id: ServerIdSchema,
  displayName: z.string().describe("Operator-configured name. Never a host or port."),
});

export const ServerListResponseSchema = z.object({
  servers: z.array(ServerSummarySchema),
});

export type ServerSummary = z.infer<typeof ServerSummarySchema>;
export type ServerListResponse = z.infer<typeof ServerListResponseSchema>;
