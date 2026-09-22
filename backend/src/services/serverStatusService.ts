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

/** Coerces a value to a real boolean, or `fallback` if it isn't one -- e.g. the
 *  string "false" (truthy in JS) from unvalidated data. Same fix already applied
 *  in powerService.ts; a review pass found the numeric-only sanitizing here was
 *  half-applied since these boolean fields passed straight through unchecked. */
function booleanOr(value: boolean, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Coerces a value to a real string, or `fallback` if it isn't one. Found by a
 *  ninth review pass: the "half-applied" sanitizing above still left sessionName
 *  unchecked -- a malformed non-string value would reach the client in a field
 *  ServerStatusResponse declares `string`, e.g. `null` breaking JSON.stringify's
 *  expectations for consumers that assume a real string. */
function stringOr(value: string, fallback: string): string {
  return typeof value === "string" ? value : fallback;
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
    // Unlike PowerService's fuseTriggered, there's no separate `status` field here
    // that a boolean fallback could contradict, so a plain fail-toward-caution
    // default (false) is safe for all three without the same self-contradiction risk.
    return {
      healthy: booleanOr(health.healthy, false),
      sessionName: stringOr(status.sessionName, ""),
      isGameRunning: booleanOr(status.isGameRunning, false),
      isPaused: booleanOr(status.isPaused, false),
      connectedPlayers: finiteOr(status.connectedPlayers, 0),
      playerLimit: finiteOr(status.playerLimit, 0),
      tickRate: finiteOr(status.tickRate, 0),
      totalGameDurationSeconds: finiteOr(status.totalGameDurationSeconds, 0),
    };
  }
}
