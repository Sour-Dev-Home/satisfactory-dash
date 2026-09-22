import { z } from "zod";

/** Unscoped and unauthenticated (ADR-0001, ADR-0011): a liveness probe for the backend
 *  itself, not the game server. */
export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
