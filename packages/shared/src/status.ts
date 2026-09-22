import { z } from "zod";
import { snapshotEnvelope } from "./envelope";

/** Units and semantics per ADR-0006 (docs-vault/wiki/decisions/0006-units-and-semantics.md). */
export const StatusSchema = z.object({
  tickHealth: z
    .enum(["healthy", "slow"])
    .describe("Server tick health: healthy = average tick rate above 10/s, else slow"),
  isGameRunning: z.boolean().describe("true = a save is loaded"),
  gamePaused: z
    .boolean()
    .describe(
      "Game simulation paused (e.g. the server's auto-pause with 0 players). Values are " +
        "frozen while true. Not the same as a building's isPaused.",
    ),
  sessionName: z
    .string()
    .describe("The loaded save's session name. Value when no game is running [NEEDS VERIFICATION]."),
  connectedPlayers: z.number().int().min(0),
  playerLimit: z.number().int().min(0),
  tickRate: z.number().min(0).describe("Ticks per second, server average"),
  totalGameDurationSeconds: z
    .number()
    .min(0)
    .describe(
      "Seconds of cumulative play time for the save (not time since it was loaded). " +
        "Behavior across a server restart [NEEDS VERIFICATION].",
    ),
});
export const StatusResponseSchema = snapshotEnvelope(StatusSchema);

export type Status = z.infer<typeof StatusSchema>;
export type StatusResponse = z.infer<typeof StatusResponseSchema>;
