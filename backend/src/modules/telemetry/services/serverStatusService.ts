import type { Status } from "@satisfactory-dash/shared";
import type { ServerHealth, ServerStatus } from "../../gameserver/index.js";

export interface ServerStatusAdapterLike {
  getServerHealth(): Promise<ServerHealth>;
  getServerStatus(): Promise<ServerStatus>;
}

/**
 * Merges the vanilla API's HealthCheck and QueryServerState into the contract's
 * Status (packages/shared/src/status.ts). The adapter validates both responses
 * (adapters/rawSchemas.ts), so the values here are already well-formed; the
 * response is validated once more against the contract on the way out (ADR-0002).
 */
export class ServerStatusService {
  constructor(private readonly adapter: ServerStatusAdapterLike) {}

  async getStatus(): Promise<Status> {
    const [health, status] = await Promise.all([
      this.adapter.getServerHealth(),
      this.adapter.getServerStatus(),
    ]);
    // Explicit field-by-field mapping, not `...status` — a spread bypasses excess-
    // property checking, so a future ServerStatus field would leak straight into the
    // API response with no compile error (found by a CI review pass).
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
}
