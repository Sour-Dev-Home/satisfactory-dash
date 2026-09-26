/**
 * The order things start in once the HTTP server is listening (issue #239). It is a function of its own, with the parts
 * passed in, so the ORDER can be tested; server.ts (the composition root) supplies the real ones.
 *
 * The rule: a server's background workers (the history pollers, the observation feed) must not run before the server registry
 * holds the servers that will really be served. With a database, the servers come from it, with their decrypted tokens;
 * the runtime built from the environment is only a placeholder until then, and a poller that fires against it goes out
 * without valid credentials, fails, and leaves one gap in the history per restart (#239). So:
 *  - process-wide workers (the event-loop monitor, ...) start at once: they need nothing;
 *  - WITHOUT a database the environment's servers are the servers, so the runtime starts at once;
 *  - WITH a database the runtime starts only after `loadServers` has finished (stored servers loaded, or the configured ones
 *    registered), together with the workers that need the database.
 * A failure (or a shutdown that began meanwhile) starts none of them.
 */
export interface StartableWorker {
  start(): void;
}

export interface BootDeps {
  /** Workers that need nothing but the process: started immediately. */
  processWorkers: readonly StartableWorker[];
  /** The servers' runtime: starts every server's pollers, and those of any server added later. */
  runtime: StartableWorker;
  /** Absent without a database. Its `start()` resolves once the database is up and its schema is current. */
  database?: { start(): Promise<void> };
  /** Loads the stored servers into the runtime (or registers the configured ones). Runs after the database is up. */
  loadServers(): Promise<void>;
  /** Workers that need the database (sessions purge, history rollup, alert evaluation): started after the servers are loaded. */
  databaseWorkers: readonly StartableWorker[];
  isShuttingDown(): boolean;
  /** A startup failure with a database: the caller logs it and exits, so the Scheduled Task's restart takes over. */
  onStartupFailure(err: unknown): void;
}

export function bootSequence(deps: BootDeps): void {
  for (const worker of deps.processWorkers) {
    worker.start();
  }
  if (deps.database === undefined) {
    deps.runtime.start();
    return;
  }
  deps.database
    .start()
    .then(() => deps.loadServers())
    .then(() => {
      if (deps.isShuttingDown()) return;
      deps.runtime.start();
      for (const worker of deps.databaseWorkers) {
        worker.start();
      }
    })
    .catch((err: unknown) => {
      if (deps.isShuttingDown()) return; // a deliberate stop is never a startup failure
      deps.onStartupFailure(err);
    });
}
