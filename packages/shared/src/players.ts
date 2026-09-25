import { z } from "zod";

/**
 * ADR-0029: who is connected. Deliberately minimal: player names are personal data about people
 * who are not users of this service, so the contract carries a name and whether the player is
 * online, and nothing else (no ID, location, health, inventory or "dead" marker). Live only:
 * nothing about it is stored or logged.
 */
export const PlayerSchema = z.object({
  name: z.string().describe("The player's in-game name, as the server reports it"),
  online: z.boolean().describe("true = currently connected"),
});

export const ServerPlayersResponseSchema = z
  .object({
    available: z
      .boolean()
      .describe(
        "false when the server has no player list to give (FicsitRemoteMonitoring not installed " +
          "or unreachable): the vanilla API only counts players, so a client falls back to " +
          "status.connectedPlayers.",
      ),
    players: z.array(PlayerSchema).describe("Empty when available is false"),
  })
  .describe("Members of the server only. Live, never stored, never logged (ADR-0029).");

export type Player = z.infer<typeof PlayerSchema>;
export type ServerPlayersResponse = z.infer<typeof ServerPlayersResponseSchema>;
