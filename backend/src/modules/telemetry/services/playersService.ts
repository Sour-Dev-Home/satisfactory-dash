import type { ServerPlayersResponse } from "@satisfactory-dash/shared";
import type { Player } from "../../gameserver/index.js";
import { readPlayers } from "../../gameserver/index.js";

export interface PlayersAdapterLike {
  getPlayers(): Promise<Player[]>;
}

/**
 * ADR-0029: who is connected, live, name and online only. Never stored, never logged, and not part
 * of history or alerts. The vanilla API only counts players, so the list needs FicsitRemoteMonitoring:
 * when FRM is not installed, not reachable, or refuses the request, the answer is `available: false`
 * (the card falls back to the counts in status) instead of an error. A response FRM DID send that
 * fails validation is still an error (a 502): that is a bug to see, not "not installed".
 *
 * The mapping and the "FRM absent" rule are the game-adapter package's `readPlayers`, shared with the edge agent (ADR-0031).
 */
export class PlayersService {
  constructor(private readonly adapter: PlayersAdapterLike) {}

  getPlayers(): Promise<ServerPlayersResponse> {
    return readPlayers(() => this.adapter.getPlayers());
  }
}
