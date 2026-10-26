import type { ServerSummary } from "@satisfactory-dash/shared";
import type { ServerDirectory } from "./serverDirectory.js";

/**
 * ADR-0030 decision 2: the set of servers this process serves is no longer fixed at boot. The
 * ServerRuntime holds each server's services and its background workers (the pollers), starts
 * them when the process is running, and starts or stops one server's workers when the server is
 * added or removed at runtime. It is also the ServerDirectory the routes resolve `:serverId` in.
 *
 * It knows nothing about game servers: the composition root builds each entry (services + workers).
 */
export interface RuntimeWorker {
  start(): void;
  stop(): Promise<void>;
}

export interface RuntimeServer<TServices> extends ServerSummary {
  services: TServices;
  workers: RuntimeWorker[];
  /** ADR-0031: `agent` for a server reached through an edge agent (its runtime is fed by the agent's snapshots, not by pollers).
   *  Absent for a server the backend polls itself. */
  kind?: "agent";
  /** ADR-0054 D3: builds a fresh, unstarted copy of a polled server (its workers are one-shot). Used when this instance
   *  stops being the leader, so the next leadership term can start new pollers. Ignored for an agent server. */
  rebuild?: (displayName: string) => RuntimeServer<TServices>;
  /** ADR-0054 D3: a digest of the connection a polled server was built from (`connectionSource`), so a reload from the
   *  database can tell an edited connection from an unchanged one. Never the connection itself. */
  source?: string;
}

/**
 * Raised when something tries to replace an agent server's runtime with a polled one. Enrolling switches a server TO an agent
 * (that replace is fine); nothing switches one back except a deliberate un-enrol, which is not a replace. A path that did it
 * by accident would silently drop the agent's live data and its `online` state, so it is refused loudly (an invariant).
 */
export class AgentRuntimeReplacedError extends Error {
  constructor(readonly serverId: string) {
    super(`Refusing to replace the agent runtime of server "${serverId}" with a polled one`);
    this.name = "AgentRuntimeReplacedError";
  }
}

export interface ServerRuntimeOptions {
  /** Called when one server's worker fails to start, so the others still start. Without it the error is thrown. */
  onWorkerStartError?: (serverId: string, err: unknown) => void;
  /** Called when one server's worker fails to stop (a stop never blocks a removal or shutdown). Log the
   *  server id and the error's name only. */
  onWorkerStopError?: (serverId: string, err: unknown) => void;
  /** Called after a server was removed and its workers stopped, so in-memory state keyed by its id can be dropped (#516:
   *  a re-created id must not inherit it). */
  onRemoved?: (serverId: string) => void;
  /** ADR-0054 D3: a polled server's workers (the pollers that read the game server) run only while this instance is the
   *  leader (`setLeader`). An agent server's workers run on every instance. Without it the instance is always leader. */
  leaderGated?: boolean;
}

export class ServerRuntime<TServices> implements ServerDirectory<TServices> {
  private readonly byId = new Map<string, RuntimeServer<TServices>>();
  private running = false;
  private leader: boolean;

  constructor(
    entries: RuntimeServer<TServices>[] = [],
    private readonly options: ServerRuntimeOptions = {},
  ) {
    this.leader = options.leaderGated !== true;
    for (const entry of entries) {
      this.register(entry);
    }
  }

  list(): ServerSummary[] {
    // Only id and displayName: GET /api/servers never exposes a host or port.
    return [...this.byId.values()].map(({ id, displayName }) => ({ id, displayName }));
  }

  get(id: string): TServices | undefined {
    return this.byId.get(id)?.services;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** ADR-0054 D3: what a reload from the database compares, an entry's kind, connection source and name (never its
   *  services or workers). Undefined for an unknown id. */
  describe(id: string): Pick<RuntimeServer<TServices>, "kind" | "source" | "displayName"> | undefined {
    const entry = this.byId.get(id);
    return entry === undefined ? undefined : { kind: entry.kind, source: entry.source, displayName: entry.displayName };
  }

  get size(): number {
    return this.byId.size;
  }

  private register(entry: RuntimeServer<TServices>): void {
    if (this.byId.has(entry.id)) {
      throw new Error(`Duplicate server id "${entry.id}"`);
    }
    this.byId.set(entry.id, entry);
  }

  private startWorkers(entry: RuntimeServer<TServices>): void {
    if (entry.kind !== "agent" && !this.leader) return; // ADR-0054 D3: a follower does not poll game servers
    for (const worker of entry.workers) {
      try {
        worker.start();
      } catch (err) {
        if (!this.options.onWorkerStartError) throw err;
        this.options.onWorkerStartError(entry.id, err);
      }
    }
  }

  /** Adds a server; its workers start now if the runtime is running, else with `start()`. */
  add(entry: RuntimeServer<TServices>): void {
    this.register(entry);
    if (this.running) {
      this.startWorkers(entry);
    }
  }

  /**
   * Removes a server: it stops resolving at once (requests get the unknown-server answer), then its
   * workers are stopped. False if there was no such server. A worker that fails to stop never
   * blocks the removal.
   */
  async remove(id: string): Promise<boolean> {
    const entry = this.byId.get(id);
    if (entry === undefined) return false;
    this.byId.delete(id);
    await this.stopWorkers(entry);
    this.options.onRemoved?.(id);
    return true;
  }

  /** Stops one server's workers; a failure is reported through `onWorkerStopError` and never thrown. */
  private async stopWorkers(entry: RuntimeServer<TServices>): Promise<void> {
    // `async` so a worker whose stop() throws synchronously is settled like a rejection.
    const results = await Promise.allSettled(entry.workers.map(async (worker) => worker.stop()));
    for (const result of results) {
      if (result.status === "rejected") this.options.onWorkerStopError?.(entry.id, result.reason);
    }
  }

  /**
   * An edit: the new entry takes the old one's place in one step (the id never stops resolving and
   * there is no window for a "duplicate id"), starts if the runtime is running, and then the old
   * entry's workers stop. Replacing an id that is not present just adds it.
   */
  async replace(entry: RuntimeServer<TServices>): Promise<void> {
    const old = this.byId.get(entry.id);
    // Checked before anything changes, so a refused replace leaves the running entry exactly as it was.
    if (old?.kind === "agent" && entry.kind !== "agent") throw new AgentRuntimeReplacedError(entry.id);
    this.byId.set(entry.id, entry);
    if (this.running) {
      this.startWorkers(entry);
    }
    if (old !== undefined) {
      await this.stopWorkers(old);
    }
  }

  /** Changes a server's display name in place (its pollers keep running). False if there is no such server. */
  rename(id: string, displayName: string): boolean {
    const entry = this.byId.get(id);
    if (entry === undefined) return false;
    this.byId.set(id, { ...entry, displayName });
    return true;
  }

  /** Starts every server's workers, and every server added later. Idempotent. */
  start(): void {
    if (this.running) return;
    this.running = true;
    for (const entry of this.byId.values()) {
      this.startWorkers(entry);
    }
  }

  /**
   * ADR-0054 D3: becoming the leader starts every polled server's workers (if the runtime is running); stepping down
   * stops them. The workers are one-shot, so on stepping down each polled entry is first swapped for a fresh, unstarted
   * build (`rebuild`), which the next term starts. The swap is synchronous, so a `setLeader(true)` that follows at once
   * starts the fresh entries while the old ones finish stopping. No-op when the state does not change.
   */
  async setLeader(leader: boolean): Promise<void> {
    if (leader === this.leader) return;
    this.leader = leader;
    const polled = [...this.byId.values()].filter((entry) => entry.kind !== "agent");
    if (leader) {
      if (this.running) {
        for (const entry of polled) this.startWorkers(entry);
      }
      return;
    }
    const stopping: Promise<void>[] = [];
    for (const old of polled) {
      if (old.rebuild !== undefined) {
        try {
          this.byId.set(old.id, { ...old.rebuild(old.displayName), rebuild: old.rebuild, source: old.source });
        } catch (err) {
          // The old entry stays: it keeps serving reads, but its pollers cannot run again until it is rebuilt by an edit.
          if (!this.options.onWorkerStartError) throw err;
          this.options.onWorkerStartError(old.id, err);
        }
      }
      stopping.push(this.stopWorkers(old));
    }
    await Promise.all(stopping);
  }

  /** Stops every server's workers (servers stay registered). */
  async stop(): Promise<void> {
    this.running = false;
    await Promise.all([...this.byId.values()].map((entry) => this.stopWorkers(entry)));
  }
}
