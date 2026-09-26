import type { Status } from "@satisfactory-dash/shared";
import type { ServerHealth, ServerStatus } from "../domain.js";

/**
 * Merges the vanilla API's HealthCheck and QueryServerState into the contract's Status (packages/shared/src/status.ts).
 * The adapter validates both responses (rawSchemas.ts), so the values here are already well-formed.
 *
 * Explicit field-by-field mapping, not `...status`: a spread bypasses excess-property checking, so a future ServerStatus
 * field would leak straight into the response with no compile error (found by a CI review pass).
 *
 * ADR-0031: this is the PURE SHAPE mapping the backend's status service and the edge agent share (moved here from the
 * backend, no behaviour change).
 */
export function mapStatus(health: ServerHealth, status: ServerStatus): Status {
  return {
    tickHealth: health.tickHealth,
    sessionName: status.sessionName,
    isGameRunning: status.isGameRunning,
    gamePaused: status.isPaused,
    connectedPlayers: status.connectedPlayers,
    playerLimit: status.playerLimit,
    tickRate: status.tickRate,
    totalGameDurationSeconds: status.totalGameDurationSeconds,
  };
}
