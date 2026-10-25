import type { MapLiveResponse } from "@satisfactory-dash/shared";
import { mapLiveEmpty, mapLiveSample } from "@satisfactory-dash/shared/fixtures";

/**
 * GET .../map/live as the mocks answer it (ADR-0038 M6): the shared `mapLive` fixtures inside the snapshot
 * envelope, which the shared fixtures don't carry. Built here, from the fixtures only, for the unit mocks
 * and the e2e scenarios alike.
 */
const envelope = { serverId: "default", observedAt: "2026-09-27T04:54:27.000Z" } as const;

export const mapLiveResponse = { ...envelope, stale: false, data: mapLiveSample } satisfies MapLiveResponse;
export const mapLiveResponseEmpty = { ...envelope, stale: false, data: mapLiveEmpty } satisfies MapLiveResponse;
/** The game server can't be reached: the last known positions, flagged by the backend. */
export const mapLiveResponseStale = {
  ...envelope,
  stale: true,
  unreachableSince: "2026-09-27T04:55:27.000Z",
  data: mapLiveSample,
} satisfies MapLiveResponse;
