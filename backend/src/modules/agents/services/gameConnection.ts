import type { SnapshotRequest } from "@satisfactory-dash/shared";
import { GAME_READ_FUTURE_SKEW_MS, LAST_SEEN_INTERVAL_MS } from "../config.js";
import type { GameConnectionValues } from "../repositories/agentRepository.js";

/** What a server's agent last said about its game connection; `lastGameReadAt` in ms. Null = not reported. */
export interface GameConnection {
  gameReachable: boolean | null;
  lastGameReadAt: number | null;
  modVersion: string | null;
}

export interface GameConnectionStoreOptions {
  /** Writes the values to the server's credential row (best effort, like the agent version). */
  record: (serverUuid: string, values: GameConnectionValues) => Promise<void>;
  /** An unchanged reachability and version, with `lastGameReadAt` only moved forward, is written at most this often. */
  writeIntervalMs?: number;
  /** A `lastGameReadAt` further ahead of the backend's clock than this is ignored. */
  futureSkewMs?: number;
}

type Reported = Pick<SnapshotRequest, "gameReachable" | "lastGameReadAt" | "modVersion">;

const later = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b));

/**
 * #740 follow-up: the latest `gameReachable`, `lastGameReadAt` and `modVersion` each server's agent reported, for the agent
 * status. Every accepted snapshot updates the memory (an unreachable one too: that is when it matters), keyed by the public
 * id the status route uses. The database copy follows the agent version's pattern (remember what was written, write only a
 * change) so the status survives a restart, but `lastGameReadAt` moves on every reachable snapshot, so a move alone is
 * written at most every `writeIntervalMs` (the memory, which the status prefers, is always current).
 */
export class GameConnectionStore {
  private readonly latest = new Map<string, GameConnection>();
  /** What the database holds as far as this process knows, by server uuid; forgotten when a write fails, so the next retries. */
  private readonly written = new Map<string, GameConnection>();
  /** Each server's writes run one after another, so an older write never lands after a newer one. */
  private readonly writing = new Map<string, Promise<void>>();
  private readonly writeIntervalMs: number;
  private readonly futureSkewMs: number;

  constructor(private readonly options: GameConnectionStoreOptions) {
    this.writeIntervalMs = options.writeIntervalMs ?? LAST_SEEN_INTERVAL_MS;
    this.futureSkewMs = options.futureSkewMs ?? GAME_READ_FUTURE_SKEW_MS;
  }

  /** Records an accepted snapshot's values. `receivedAtMs` is the backend's clock when it arrived. */
  observe(agent: { serverUuid: string; publicId: string }, snapshot: Reported, receivedAtMs: number): void {
    const readAt = snapshot.lastGameReadAt === undefined ? Number.NaN : Date.parse(snapshot.lastGameReadAt);
    const accepted = Number.isFinite(readAt) && readAt <= receivedAtMs + this.futureSkewMs ? readAt : null;
    const next: GameConnection = {
      gameReachable: snapshot.gameReachable ?? null,
      lastGameReadAt: later(this.latest.get(agent.publicId)?.lastGameReadAt ?? null, accepted),
      modVersion: snapshot.modVersion ?? null,
    };
    this.latest.set(agent.publicId, next);
    if (!this.needsWrite(this.written.get(agent.serverUuid), next)) return;
    this.written.set(agent.serverUuid, next);
    const values: GameConnectionValues = {
      gameReachable: next.gameReachable,
      lastGameReadAt: next.lastGameReadAt === null ? null : new Date(next.lastGameReadAt),
      modVersion: next.modVersion,
    };
    const run = (this.writing.get(agent.serverUuid) ?? Promise.resolve())
      .then(() => this.options.record(agent.serverUuid, values))
      .catch(() => {
        if (this.written.get(agent.serverUuid) === next) this.written.delete(agent.serverUuid);
      })
      .finally(() => {
        if (this.writing.get(agent.serverUuid) === run) this.writing.delete(agent.serverUuid);
      });
    this.writing.set(agent.serverUuid, run);
  }

  /** The latest values this process received for the server, or undefined when none arrived since it started. */
  get(publicId: string): GameConnection | undefined {
    return this.latest.get(publicId);
  }

  /** Tests only: resolves once every write started so far has settled. */
  async settled(): Promise<void> {
    await Promise.all(this.writing.values());
  }

  private needsWrite(known: GameConnection | undefined, next: GameConnection): boolean {
    if (known === undefined || known.gameReachable !== next.gameReachable || known.modVersion !== next.modVersion) return true;
    if (next.lastGameReadAt === null || next.lastGameReadAt === known.lastGameReadAt) return false;
    return known.lastGameReadAt === null || next.lastGameReadAt - known.lastGameReadAt >= this.writeIntervalMs;
  }
}
