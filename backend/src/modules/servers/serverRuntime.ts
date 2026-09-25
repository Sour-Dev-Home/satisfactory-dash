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
    // `async` so a worker whose stop() throws synchronously is settled like a rejection.
    await Promise.allSettled(entry.workers.map(async (worker) => worker.stop()));
    return true;
  }

  /** An edit: the old server's workers stop, then the new entry takes its place (and starts if running). */
  async replace(entry: RuntimeServer<TServices>): Promise<void> {
    await this.remove(entry.id);
    this.add(entry);
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
    await Promise.allSettled([...this.byId.values()].flatMap((entry) => entry.workers.map(async (worker) => worker.stop())));
  }
}
