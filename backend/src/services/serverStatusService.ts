import type { ServerStatusResponse } from "@satisfactory-dash/shared";
import type { ServerHealth, ServerStatus } from "../adapters/domain.js";

export interface ServerStatusAdapterLike {
  getServerHealth(): Promise<ServerHealth>;
  getServerStatus(): Promise<ServerStatus>;
}

export class ServerStatusService {
  constructor(private readonly adapter: ServerStatusAdapterLike) {}

  async getStatus(): Promise<ServerStatusResponse> {
    const [health, status] = await Promise.all([
      this.adapter.getServerHealth(),
      this.adapter.getServerStatus(),
    ]);
    // Explicit field-by-field mapping, not `...status` — a spread bypasses excess-
    // property checking, so a future ServerStatus field would leak straight into the
    // API response with no compile error, unlike ProductionService/PowerService.
    return {
      healthy: health.healthy,
      sessionName: status.sessionName,
      isGameRunning: status.isGameRunning,
      isPaused: status.isPaused,
      connectedPlayers: status.connectedPlayers,
      playerLimit: status.playerLimit,
      tickRate: status.tickRate,
      totalGameDurationSeconds: status.totalGameDurationSeconds,
    };
  }
}
