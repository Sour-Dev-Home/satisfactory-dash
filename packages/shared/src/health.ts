import { z } from "zod";

/** Unscoped and unauthenticated (ADR-0001, ADR-0011): a liveness probe for the backend
 *  itself, not the game server. */
export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/**
 * GET /api/health/ready (ADR-0025 decision 6): readiness, as opposed to the liveness above.
 * 200 `ok` when the dependencies the backend needs answer (the database, once configured),
 * 503 `unavailable` otherwise. Public, so the body never says WHICH dependency failed. With no
 * database configured it answers ok.
 */
export const ReadinessResponseSchema = z.object({
  status: z.enum(["ok", "unavailable"]),
});
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
