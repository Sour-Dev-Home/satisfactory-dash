/**
 * ADR-0054 D3: the workers that run only on the leader instance (session purge, history maintenance, the sweepers, the
 * alert evaluator and alert delivery). Most of them are one-shot (a stopped worker stays stopped), so each leadership
 * term builds fresh instances from the factories: `start()` builds and starts them, `stop()` stops that term's set.
 * A fresh alert evaluator also starts its own clock, which is what gives a new leader the restart grace (D3.4).
 */
export interface GroupWorker {
  start(): void;
  stop(): Promise<void>;
}

export interface LeaderWorkerGroupLogger {
  error(obj: object, msg: string): void;
}

export class LeaderWorkerGroup {
  private current: GroupWorker[] | undefined;

  constructor(
    private readonly factories: readonly (() => GroupWorker)[],
    private readonly logger: LeaderWorkerGroupLogger,
  ) {}

  /** True while a term's workers are running. */
  get running(): boolean {
    return this.current !== undefined;
  }

  /** Builds and starts one term's workers. Idempotent while running. One failing factory or start never stops the rest. */
  start(): void {
    if (this.current !== undefined) return;
    const workers: GroupWorker[] = [];
    for (const [index, factory] of this.factories.entries()) {
      try {
        const worker = factory();
        workers.push(worker);
        worker.start();
      } catch (err) {
        this.logger.error({ worker: index, error: err instanceof Error ? err.name : "unknown" }, "a leader-only worker failed to start");
      }
    }
    this.current = workers;
  }

  /** Stops the running term's workers and waits for them. A worker whose stop fails never blocks the others. */
  async stop(): Promise<void> {
    const workers = this.current;
    this.current = undefined;
    if (workers === undefined) return;
    await Promise.allSettled(workers.map(async (worker) => worker.stop()));
  }
}
