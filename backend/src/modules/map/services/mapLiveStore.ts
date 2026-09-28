import { MAP_LIVE_MAX_STATIONS, MAP_LIVE_MAX_TRAINS, MapTrainSchema, MapTrainStationSchema } from "@satisfactory-dash/shared";
import type { MapLive } from "@satisfactory-dash/shared";

/**
 * ADR-0038 M3/M6: `mapLive` (trains, stations) is read-through only (ADR-0004) — never stored in
 * the database, unlike the world layers. One process-wide store, keyed by the server's PUBLIC id,
 * fed by whichever path the server uses: telemetry's agent snapshot ingest (an agent-backed server,
 * via the narrow `MapLiveSink` port telemetry defines — this module is never imported by telemetry)
 * or this module's own local-server poller. GET .../map/live reads it.
 */
export interface MapLiveReading {
  data: MapLive;
  observedAtMs: number;
}

/** What a writer needs: telemetry's `AgentIngestDeps.mapLive` and the local poller both satisfy
 *  this by construction (bound to one server's id in server.ts), never a bare `MapLiveStore`. */
export interface MapLiveSink {
  record(data: MapLive, observedAtMs: number): void;
}

/**
 * Conform, don't reject (test-hunter, PR #374): an agent's `mapLive` reaches here only after
 * `SnapshotRequestSchema` already validated it at the wire (agentApi.ts's snapshot route), but the
 * LOCAL poller's `getTrains`/`getTrainStations` reach here with no such boundary in between — only
 * a coordinate-bounds check (game-adapter's trainsMapper.ts/stationsMapper.ts), never a string-length
 * one. Without this, one oversized/malformed train or station name would store un-conforming data
 * that later fails `MapLiveResponseSchema` at GET .../map/live (a 500 for that whole server, until
 * a later, conforming reading overwrites it). A bad item is dropped, never the whole reading; the
 * two arrays are also capped here, same as the schema would cap them on the wire.
 */
function conformMapLive(data: MapLive): MapLive {
  return {
    trains: data.trains.filter((train) => MapTrainSchema.safeParse(train).success).slice(0, MAP_LIVE_MAX_TRAINS),
    stations: data.stations.filter((station) => MapTrainStationSchema.safeParse(station).success).slice(0, MAP_LIVE_MAX_STATIONS),
  };
}

export class MapLiveStore {
  private readonly byServer = new Map<string, MapLiveReading>();

  record(serverPublicId: string, data: MapLive, observedAtMs: number): void {
    this.byServer.set(serverPublicId, { data: conformMapLive(data), observedAtMs });
  }

  /** The server's own bound sink (server.ts wires this into telemetry's AgentIngestDeps and into
   *  this server's local poller, so neither needs to know its own id at call time). */
  sinkFor(serverPublicId: string): MapLiveSink {
    return { record: (data, observedAtMs) => this.record(serverPublicId, data, observedAtMs) };
  }

  latest(serverPublicId: string): MapLiveReading | undefined {
    return this.byServer.get(serverPublicId);
  }

  /** For a removed server: nothing else purges this map (ADR-0001's revisit trigger; today's single
   *  entry never grows unbounded in practice, but a removed server should not leak forever). */
  forget(serverPublicId: string): void {
    this.byServer.delete(serverPublicId);
  }
}
