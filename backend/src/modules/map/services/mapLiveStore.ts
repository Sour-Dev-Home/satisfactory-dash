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

export class MapLiveStore {
  private readonly byServer = new Map<string, MapLiveReading>();

  record(serverPublicId: string, data: MapLive, observedAtMs: number): void {
    this.byServer.set(serverPublicId, { data, observedAtMs });
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
