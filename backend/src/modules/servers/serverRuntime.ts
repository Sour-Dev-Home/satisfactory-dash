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
}

export interface ServerRuntimeOptions {
  /** Called when one server's worker fails to start, so the others still start. Without it the error is thrown. */
  onWorkerStartError?: (serverId: string, err: unknown) => void;
  /** Called when one server's worker fails to stop (a stop never blocks a removal or shutdown). Log the
   *  server id and the error's name only. */
  onWorkerStopError?: (serverId: string, err: unknown) => void;
}

export class ServerRuntime<TServices> implements ServerDirectory<TServices> {
  private readonly byId = new Map<string, RuntimeServer<TServices>>();
  private running = false;

  constructor(
    entries: RuntimeServer<TServices>[] = [],
    private readonly options: ServerRuntimeOptions = {},
  ) {
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

  /** Stops every server's workers (servers stay registered). */
  async stop(): Promise<void> {
    this.running = false;
    await Promise.all([...this.byId.values()].map((entry) => this.stopWorkers(entry)));
  }
}
