import { z } from "zod";
import { ServerIdSchema } from "./ids";

/**
 * ADR-0004: every data response is wrapped in the same snapshot envelope, so moving
 * from request-through to a background poller needs no contract change. The backend
 * decides `stale` (avoids client clock skew). "Game paused" is a separate state, carried
 * in the status payload, not here.
 */
export function snapshotEnvelope<T extends z.ZodType>(data: T) {
  return z.object({
    serverId: ServerIdSchema,
    observedAt: z.iso.datetime().describe("UTC time the backend read this from the game server"),
    stale: z.boolean().describe("true = last known data; refreshing from the game server is failing"),
    data,
  });
}
