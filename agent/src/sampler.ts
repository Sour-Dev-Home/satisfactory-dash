import { UpstreamError } from "@satisfactory-dash/game-adapter";
import { AGENT_INPUT_MAX_STRING } from "@satisfactory-dash/shared";
import type { AgentFactory, AgentPower, Cadence, MapLive, ServerPlayersResponse, SnapshotRequest, Status } from "@satisfactory-dash/shared";
import { conformFactory, conformPlayers, conformPower, conformStatus } from "./conform.js";
import type { AgentLogger } from "./logger.js";
import { AGENT_VERSION } from "./version.js";

/**
 * What the sampler needs from the game: one method per source. The real one (gameReader.ts) uses the game-adapter package;
 * tests use fakes. Every read may throw; an `UpstreamError` means the game (or the path to it) failed.
 */
export interface GameReader {
  readStatus(): Promise<Status>;
  readPower(): Promise<AgentPower>;
  readFactory(): Promise<AgentFactory>;
  /** `available: false` (never a throw) when FRM is absent, as the adapter package defines it. */
  readPlayers(): Promise<ServerPlayersResponse>;
  readAutoPause(): Promise<boolean>;
  applyAutoPause(enabled: boolean): Promise<void>;
  /** Trains and stations for the map (ADR-0038 step 5), with the mappers' dropped count. Optional: a reader without it sends no `mapLive`. */
  readMapLive?(): Promise<MapLive & { dropped: number }>;
}

/** ADR-0038's live-tier caps, tighter than the schema's sanity caps (`MAP_LIVE_MAX_TRAINS`/`_STATIONS`): items per kind... */
export const MAP_LIVE_AGENT_MAX_ITEMS = 500;
/** ...and the serialized part's size, uncompressed, measured the way the world reader measures its layers. */
export const MAP_LIVE_AGENT_MAX_BYTES = 256_000;

const cut = (text: string): string => (text.length > AGENT_INPUT_MAX_STRING ? text.slice(0, AGENT_INPUT_MAX_STRING) : text);

/** Cuts each kind to the item cap and each string to the contract's length; `adjusted` counts the items and strings cut. */
function conformMapLive(live: MapLive): { value: MapLive; adjusted: number } {
  let adjusted = Math.max(0, live.trains.length - MAP_LIVE_AGENT_MAX_ITEMS) + Math.max(0, live.stations.length - MAP_LIVE_AGENT_MAX_ITEMS);
  const text = (value: string): string => {
    const conformed = cut(value);
    if (conformed !== value) adjusted++;
    return conformed;
  };
  const trains = live.trains.slice(0, MAP_LIVE_AGENT_MAX_ITEMS).map((t) => ({ id: text(t.id), name: text(t.name), x: t.x, y: t.y, status: text(t.status) }));
  const stations = live.stations.slice(0, MAP_LIVE_AGENT_MAX_ITEMS).map((s) => ({ id: text(s.id), name: text(s.name), x: s.x, y: s.y }));
  return { value: { trains, stations }, adjusted };
}

/** A short plain code for a failure, safe to log: never the error's message (it could carry a URL, an address or a token). */
export function failureCode(err: unknown): string {
  if (err instanceof UpstreamError) {
    if (err.failureKind === "unreachable") return "upstream_unreachable";
    if (err.failureKind === "invalid_response") return "upstream_invalid_response";
    if (err.status === 401 || err.status === 403) return "upstream_auth_rejected";
    return "upstream_error";
  }
  return "internal_error";
}

/** A wake-up a hair early (timers are not exact, and the clock and the timer disagree by a millisecond) must not cost a whole period. */
const DUE_SLACK_MS = 250;

/** Due when a period has passed (within the slack), or when the clock went BACKWARDS since the last read (never silence a part until it catches up). */
const isDue = (nowMs: number, lastMs: number, seconds: number): boolean => {
  const elapsed = nowMs - lastMs;
  return elapsed < 0 || elapsed >= seconds * 1000 - DUE_SLACK_MS;
};

export interface SamplerOptions {
  reader: GameReader;
  /** Read on every use, so a cadence the backend changes applies at once. */
  cadence: () => Cadence;
  logger: AgentLogger;
  agentVersion?: string;
}

/**
 * Builds one snapshot per call (ADR-0031 PR 6). It follows the contract's rules:
 *  - the status is read on every call (it says whether the game is reachable and paused), and the other parts only when due
 *    by their own cadence (`powerSeconds`, `factorySeconds`), so a snapshot carries the parts that were due;
 *  - a game that cannot be reached sends `reachable: false`, `paused: null` and NO parts and NO `settings`;
 *  - every snapshot carries `gameReachable` (= `reachable`), `modVersion` (= `agentVersion`) and, once the game has been
 *    read at least once, `lastGameReadAt` (S4-A, R7; the rule is spelled out in `sample`);
 *  - `settings.autoPause` is read on each status cadence and sent ONLY when the game is reachable and the read worked;
 *    a failed read is left out (never a stale or guessed value) and logged once per change, not per call;
 *  - a part that fails while the game is otherwise reachable is left out and logged as a code, never with its message;
 *  - every part is conformed to the backend's input bounds first (conform.ts);
 *  - `mapLive` (trains, stations; ADR-0038 step 5) follows the factory cadence, is cut to 500 items per kind, and is left
 *    out whole, warned once per streak, when its JSON passes 256 KB (a map missing trains it doesn't say it's missing
 *    would mislead, so it is never cut short by bytes).
 */
export class Sampler {
  private lastPower = -Infinity;
  private lastFactory = -Infinity;
  private lastMapLive = -Infinity;
  private mapLiveOverCap = false;
  private lastAutoPause = -Infinity;
  private failing = new Set<string>();
  private lastAdjustedLogAt = -Infinity;
  /** The observedAt of the last pass whose status read worked, or null before the first one. */
  private lastGameReadAt: string | null = null;

  constructor(private readonly options: SamplerOptions) {}

  async sample(nowMs: number): Promise<SnapshotRequest> {
    const { reader, logger } = this.options;
    const cadence = this.options.cadence();
    const agentVersion = this.options.agentVersion ?? AGENT_VERSION;
    const observedAt = new Date(nowMs).toISOString();
    // `modVersion` is the SENDER's version (the mod's or, here, the agent's): the same string as `agentVersion`, which is
    // at most 32 characters, inside the contract's 64.
    const base = { agentVersion, observedAt, modVersion: agentVersion };

    // S4-A (R7): `gameReachable` follows `reachable` exactly. It is true when this pass's status read worked, which
    // includes a PAUSED game (a paused game still answers; `paused` says the rest). A part failing while the status read
    // works does not make the game unreachable. `lastGameReadAt` is the observedAt of the last pass whose status read
    // worked: kept across failed passes, and left out until the first success since the agent started.
    let status: Status;
    try {
      status = conformStatus(await reader.readStatus());
      this.recovered("status");
    } catch (err) {
      this.failed("status", err);
      // The game or its path failed: the whole pass is "unreachable", and the parts wait for the next pass.
      const lastRead = this.lastGameReadAt === null ? {} : { lastGameReadAt: this.lastGameReadAt };
      return { ...base, ...lastRead, reachable: false, paused: null, gameReachable: false };
    }
    this.lastGameReadAt = observedAt;

    const powerDue = isDue(nowMs, this.lastPower, cadence.powerSeconds);
    const factoryDue = isDue(nowMs, this.lastFactory, cadence.factorySeconds);
    const autoPauseDue = isDue(nowMs, this.lastAutoPause, cadence.statusSeconds);
    const readMapLive = reader.readMapLive?.bind(reader);
    const mapLiveDue = readMapLive !== undefined && isDue(nowMs, this.lastMapLive, cadence.factorySeconds);
    if (powerDue) this.lastPower = nowMs;
    if (factoryDue) this.lastFactory = nowMs;
    if (autoPauseDue) this.lastAutoPause = nowMs;
    if (mapLiveDue) this.lastMapLive = nowMs;

    const [power, factory, players, autoPause, mapLive] = await Promise.all([
      powerDue ? this.part("power", () => reader.readPower()) : undefined,
      factoryDue ? this.part("factory", () => reader.readFactory()) : undefined,
      this.part("players", () => reader.readPlayers()), // the player list follows the status cadence
      autoPauseDue ? this.part("auto_pause", () => reader.readAutoPause()) : undefined,
      mapLiveDue ? this.part("map_live", () => readMapLive()) : undefined,
    ]);

    let adjusted = 0;
    const snapshot: SnapshotRequest = { ...base, lastGameReadAt: observedAt, reachable: true, paused: status.gamePaused, gameReachable: true, status };
    if (power !== undefined) {
      const conformed = conformPower(power);
      adjusted += conformed.adjusted;
      snapshot.power = conformed.value;
    }
    if (factory !== undefined) {
      const conformed = conformFactory(factory);
      adjusted += conformed.adjusted;
      snapshot.factory = conformed.value;
    }
    if (players !== undefined) {
      const conformed = conformPlayers(players);
      adjusted += conformed.adjusted;
      snapshot.players = conformed.value;
    }
    if (autoPause !== undefined) snapshot.settings = { autoPause };
    if (mapLive !== undefined) {
      const conformed = conformMapLive(mapLive);
      adjusted += conformed.adjusted + mapLive.dropped;
      const bytes = Buffer.byteLength(JSON.stringify(conformed.value));
      if (bytes > MAP_LIVE_AGENT_MAX_BYTES) {
        if (!this.mapLiveOverCap) logger.warn("map_live_over_cap", { bytes, maxBytes: MAP_LIVE_AGENT_MAX_BYTES });
        this.mapLiveOverCap = true;
      } else {
        this.mapLiveOverCap = false;
        snapshot.mapLive = conformed.value;
      }
    }
    // At most one line a minute: a game that keeps sending an out-of-range value must not fill the log every few seconds.
    if (adjusted > 0 && (nowMs - this.lastAdjustedLogAt >= 60_000 || nowMs < this.lastAdjustedLogAt)) {
      this.lastAdjustedLogAt = nowMs;
      logger.warn("readings_adjusted", { entries: adjusted });
    }
    return snapshot;
  }

  /** Runs one part's read; a failure leaves the part out and is logged once per change of state. */
  private async part<T>(name: string, read: () => Promise<T>): Promise<T | undefined> {
    try {
      const value = await read();
      this.recovered(name);
      return value;
    } catch (err) {
      this.failed(name, err);
      return undefined;
    }
  }

  private failed(name: string, err: unknown): void {
    if (this.failing.has(name)) return; // already reported: not once per pass
    this.failing.add(name);
    this.options.logger.warn("read_failed", { part: name, code: failureCode(err) });
  }

  private recovered(name: string): void {
    if (this.failing.delete(name)) this.options.logger.info("read_recovered", { part: name });
  }
}
