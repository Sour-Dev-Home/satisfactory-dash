import type { ServerPlayersResponse } from "@satisfactory-dash/shared";
import type { Player } from "../domain.js";
import { UpstreamError } from "../errors.js";

/**
 * ADR-0029: who is connected, live, name and online only. The vanilla API only counts players, so the list needs
 * FicsitRemoteMonitoring: when FRM is not installed, not reachable, or refuses the request, the answer is
 * `available: false` (the card falls back to the counts in status) instead of an error. A response FRM DID send that
 * fails validation is still an error: that is a bug to see, not "not installed".
 *
 * ADR-0031: the shared shape mapping of the backend's players service and the edge agent (moved here, no behaviour change).
 */
export function mapPlayers(players: Player[]): ServerPlayersResponse {
  // Explicit field mapping, so a future domain field can never leak into the response.
  return { available: true, players: players.map((player) => ({ name: player.name, online: player.online })) };
}

/** FRM did not answer usefully: unreachable/timeout, or an HTTP error status (not installed, token refused, server
 *  error). An invalid_response is NOT absent. */
export function isFrmAbsent(err: unknown): boolean {
  return err instanceof UpstreamError && err.failureKind !== "invalid_response";
}

/** Reads the players through `getPlayers`, answering `available: false` when FRM is absent and rethrowing anything else. */
export async function readPlayers(getPlayers: () => Promise<Player[]>): Promise<ServerPlayersResponse> {
  try {
    return mapPlayers(await getPlayers());
  } catch (err) {
    if (isFrmAbsent(err)) {
      return { available: false, players: [] };
    }
    throw err;
  }
}
