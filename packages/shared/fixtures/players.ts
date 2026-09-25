import type { ServerPlayersResponse } from "../src/index";

// ADR-0029. Obviously fake names: these are for tests and mock servers only, never a real player's.

/** FRM is there: three players online and one who has played on this save but is offline. */
export const playersAvailable = {
  available: true,
  players: [
    { name: "Pioneer-Alpha", online: true },
    { name: "Pioneer-Bravo", online: true },
    { name: "Pioneer-Charlie", online: true },
    { name: "Pioneer-Delta", online: false },
  ],
} satisfies ServerPlayersResponse;

/** FicsitRemoteMonitoring is not installed or not reachable: no list, so a client falls back to the
 *  counts in status.connectedPlayers. */
export const playersUnavailable = { available: false, players: [] } satisfies ServerPlayersResponse;

/** FRM is there and nobody has played yet. Not the same as unavailable. */
export const playersEmpty = { available: true, players: [] } satisfies ServerPlayersResponse;
