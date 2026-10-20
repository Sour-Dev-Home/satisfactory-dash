/**
 * The game-server supervisor (ADR-0040 decision 2): pure state logic over an injected spawn, so it is tested with a
 * fake process and never needs the game.
 *
 * - Start runs the configured exe with the fixed SERVER_ARGS. The caller's SpawnFn never uses a shell.
 * - An exit the app didn't ask for (a crash, a clean exit, a spawn error) restarts the server at once, at most
 *   MAX_RESTARTS times in RESTART_WINDOW_MS. One more and the state is `crashed`, with the reason in lastError().
 * - Stop just ends the process for now; the next build task replaces it with save-then-shutdown.
 */

export type ServerState = "stopped" | "starting" | "running" | "stopping" | "crashed";

/** The slice of a child process the supervisor needs; main.ts adapts node's ChildProcess to it. */
export interface ChildHandle {
  readonly pid: number | undefined;
  kill(): void;
  onSpawn(cb: () => void): void;
  onExit(cb: (code: number | null, signal: string | null) => void): void;
  onError(cb: (err: Error) => void): void;
}

export type SpawnFn = (exe: string, args: readonly string[]) => ChildHandle;

export interface Supervisor {
  start(): void;
  stop(): Promise<void>;
  restart(): Promise<void>;
  state(): ServerState;
  onChange(cb: (state: ServerState) => void): () => void;
  lastError(): string | undefined;
}

export const SERVER_ARGS: readonly string[] = Object.freeze(["-log"]);
export const MAX_RESTARTS = 3;
export const RESTART_WINDOW_MS = 10 * 60_000;

export function createSupervisor(opts: { spawn: SpawnFn; now: () => number; serverExe: string }): Supervisor {
  let current: ServerState = "stopped";
  let child: ChildHandle | undefined;
  let error: string | undefined;
  let restarts: number[] = [];
  let stopRequested = false;
  let stopping: Promise<void> | undefined;
  let resolveStop: (() => void) | undefined;
  const listeners = new Set<(state: ServerState) => void>();

  function set(next: ServerState): void {
    if (next === current) return;
    current = next;
    for (const cb of listeners) {
      try {
        cb(next);
      } catch {
        // A broken listener must not stop the supervisor or the other listeners.
      }
    }
  }

  function launch(): void {
    set("starting");
    let handled = false;
    let proc: ChildHandle;
    const ended = (reason: string) => {
      if (handled || child !== proc) return;
      handled = true;
      onEnded(reason);
    };
    try {
      proc = opts.spawn(opts.serverExe, SERVER_ARGS);
    } catch (err) {
      child = undefined;
      onEnded(`could not start: ${message(err)}`);
      return;
    }
    child = proc;
    proc.onSpawn(() => {
      if (child === proc && current === "starting" && !stopRequested) set("running");
    });
    proc.onExit((code, signal) => ended(signal !== null ? `stopped by signal ${signal}` : `exit code ${code ?? "unknown"}`));
    proc.onError((err) => ended(`could not start: ${message(err)}`));
  }

  function onEnded(reason: string): void {
    child = undefined;
    if (stopRequested) {
      stopRequested = false;
      set("stopped");
      const resolve = resolveStop;
      stopping = undefined;
      resolveStop = undefined;
      resolve?.();
      return;
    }
    const now = opts.now();
    restarts = restarts.filter((t) => now - t < RESTART_WINDOW_MS);
    if (restarts.length < MAX_RESTARTS) {
      restarts.push(now);
      error = `The server stopped on its own (${reason}); restarted it.`;
      launch();
      return;
    }
    error = `The server stopped on its own ${MAX_RESTARTS + 1} times in 10 minutes; not restarting. Last: ${reason}.`;
    set("crashed");
  }

  function start(): void {
    if (current !== "stopped" && current !== "crashed") return;
    error = undefined;
    restarts = [];
    launch();
  }

  function stop(): Promise<void> {
    if (stopping) return stopping;
    if (current === "stopped" || current === "crashed" || !child) return Promise.resolve();
    stopRequested = true;
    stopping = new Promise<void>((resolve) => {
      resolveStop = resolve;
    });
    set("stopping");
    child.kill();
    return stopping;
  }

  return {
    start,
    stop,
    async restart() {
      await stop();
      start();
    },
    state: () => current,
    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    lastError: () => error,
  };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
