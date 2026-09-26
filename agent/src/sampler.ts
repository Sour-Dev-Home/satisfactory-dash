import { UpstreamError } from "@satisfactory-dash/game-adapter";
import type { AgentFactory, AgentPower, Cadence, ServerPlayersResponse, SnapshotRequest, Status } from "@satisfactory-dash/shared";
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
 *  - `settings.autoPause` is read on each status cadence and sent ONLY when the game is reachable and the read worked;
 *    a failed read is left out (never a stale or guessed value) and logged once per change, not per call;
 *  - a part that fails while the game is otherwise reachable is left out and logged as a code, never with its message;
 *  - every part is conformed to the backend's input bounds first (conform.ts).
 */
export class Sampler {
  private lastPower = -Infinity;
  private lastFactory = -Infinity;
  private lastAutoPause = -Infinity;
  private failing = new Set<string>();

  constructor(private readonly options: SamplerOptions) {}

  async sample(nowMs: number): Promise<SnapshotRequest> {
    const { reader, logger } = this.options;
    const cadence = this.options.cadence();
    const base = { agentVersion: this.options.agentVersion ?? AGENT_VERSION, observedAt: new Date(nowMs).toISOString() };

    let status: Status;
    try {
      status = conformStatus(await reader.readStatus());
      this.recovered("status");
    } catch (err) {
      this.failed("status", err);
      // The game or its path failed: the whole pass is "unreachable", and the parts wait for the next pass.
      return { ...base, reachable: false, paused: null };
    }

    const powerDue = isDue(nowMs, this.lastPower, cadence.powerSeconds);
    const factoryDue = isDue(nowMs, this.lastFactory, cadence.factorySeconds);
    const autoPauseDue = isDue(nowMs, this.lastAutoPause, cadence.statusSeconds);
    if (powerDue) this.lastPower = nowMs;
    if (factoryDue) this.lastFactory = nowMs;
    if (autoPauseDue) this.lastAutoPause = nowMs;

    const [power, factory, players, autoPause] = await Promise.all([
      powerDue ? this.part("power", () => reader.readPower()) : undefined,
      factoryDue ? this.part("factory", () => reader.readFactory()) : undefined,
      this.part("players", () => reader.readPlayers()), // the player list follows the status cadence
      autoPauseDue ? this.part("auto_pause", () => reader.readAutoPause()) : undefined,
    ]);

    let adjusted = 0;
    const snapshot: SnapshotRequest = { ...base, reachable: true, paused: status.gamePaused, status };
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
    if (adjusted > 0) logger.warn("readings_adjusted", { entries: adjusted });
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
