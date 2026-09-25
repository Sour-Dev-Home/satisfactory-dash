import type { ServerPlayersResponse } from "@satisfactory-dash/shared";
import type { Player } from "../../gameserver/index.js";
import { UpstreamError } from "../../../platform/errors.js";

export interface PlayersAdapterLike {
  getPlayers(): Promise<Player[]>;
}

/**
 * ADR-0029: who is connected, live, name and online only. Never stored, never logged, and not part
 * of history or alerts. The vanilla API only counts players, so the list needs FicsitRemoteMonitoring:
 * when FRM is not installed, not reachable, or refuses the request, the answer is `available: false`
 * (the card falls back to the counts in status) instead of an error. A response FRM DID send that
 * fails validation is still an error (a 502): that is a bug to see, not "not installed".
 */
export class PlayersService {
  constructor(private readonly adapter: PlayersAdapterLike) {}

  async getPlayers(): Promise<ServerPlayersResponse> {
    try {
      const players = await this.adapter.getPlayers();
      // Explicit field mapping, so a future domain field can never leak into the response.
      return { available: true, players: players.map((player) => ({ name: player.name, online: player.online })) };
    } catch (err) {
      if (isFrmAbsent(err)) {
        return { available: false, players: [] };
      }
      throw err;
    }
  }
}

/** FRM did not answer usefully: unreachable/timeout, or an HTTP error status (not installed, token
 *  refused, server error). An invalid_response is NOT absent. */
function isFrmAbsent(err: unknown): boolean {
  return err instanceof UpstreamError && err.failureKind !== "invalid_response";
}
