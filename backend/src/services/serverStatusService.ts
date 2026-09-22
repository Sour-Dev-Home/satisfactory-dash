import type { ServerStatusResponse } from "@satisfactory-dash/shared";
import type { ServerHealth, ServerStatus } from "../adapters/domain.js";

export interface ServerStatusAdapterLike {
  getServerHealth(): Promise<ServerHealth>;
  getServerStatus(): Promise<ServerStatus>;
}

/** Coerces a value to a finite number, or `fallback` if it isn't one -- e.g. a NaN
 *  from unvalidated vanilla-API data (see docs-vault/wiki/lessons-learned.md).
 *  Without this, a NaN survives internally but silently becomes JSON `null` on the
 *  wire, contradicting ServerStatusResponse's `number` fields. Same fix already
 *  applied in powerService.ts. */
function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
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
      connectedPlayers: finiteOr(status.connectedPlayers, 0),
      playerLimit: finiteOr(status.playerLimit, 0),
      tickRate: finiteOr(status.tickRate, 0),
      totalGameDurationSeconds: finiteOr(status.totalGameDurationSeconds, 0),
    };
  }
}
