/**
 * The game-server supervisor (ADR-0040 decision 2): pure state logic over an injected spawn, so it is tested with a
 * fake process and never needs the game.
 *
 * - Start runs the configured exe with the fixed SERVER_ARGS. The caller's SpawnFn never uses a shell.
 * - An exit the app didn't ask for (a crash, a clean exit, a spawn error) restarts the server at once, at most
 *   MAX_RESTARTS times in RESTART_WINDOW_MS. One more and the state is `crashed`, with the reason in lastError().
 * - Stop is the clean stop: the game's own API saves the current session, then shuts the server down. If the process
 *   is still there SHUTDOWN_TIMEOUT_MS after Shutdown, it is ended and lastError() says so. Without the API (no token
 *   stored) or when saving fails, nothing is stopped: stop() resolves `unavailable` or `failed` with the reason in
 *   lastError(), and `stop({ anyway: true })` ends the process without saving.
 */
import type { GameApi } from "./gameApi";

export type ServerState = "stopped" | "starting" | "running" | "stopping" | "crashed";

/** How the clean stop reaches the game: its API, or why it can't (said to the user, so never the token). */
export type GameApiAccess = { ok: true; api: GameApi } | { ok: false; reason: string };

/** `stopped`: the process is gone. `unavailable`/`failed`: it still runs, and only "Stop anyway" would end it. */
export type StopOutcome = "stopped" | "unavailable" | "failed";

export interface StopOptions {
  /** End the process without saving (the window's "Stop anyway"). */
  anyway?: boolean;
}

export type TimerFn = (cb: () => void, ms: number) => () => void;

/** The slice of a child process the supervisor needs; main.ts adapts node's ChildProcess to it. */
export interface ChildHandle {
  readonly pid: number | undefined;
  kill(): void;
  onSpawn(cb: () => void): void;
  onExit(cb: (code: number | null, signal: string | null) => void): void;
  onError(cb: (err: Error) => void): void;
  /** Its stdout and stderr, when the spawn pipes them (SteamCMD's does; the server's doesn't). */
  onOutput?(cb: (chunk: string) => void): void;
}

export type SpawnFn = (exe: string, args: readonly string[]) => ChildHandle;

export interface Supervisor {
  start(): void;
  stop(opts?: StopOptions): Promise<StopOutcome>;
  /** Stops (as stop() does), then starts only if the stop ended the process. */
  restart(opts?: StopOptions): Promise<StopOutcome>;
  state(): ServerState;
  onChange(cb: (state: ServerState) => void): () => void;
  lastError(): string | undefined;
}

export const SERVER_ARGS: readonly string[] = Object.freeze(["-log"]);
export const MAX_RESTARTS = 3;
export const RESTART_WINDOW_MS = 10 * 60_000;
export const SHUTDOWN_TIMEOUT_MS = 60_000;

export const UNCLEAN_STOP = "Stopped without a clean shutdown";

const defaultTimer: TimerFn = (cb, ms) => {
  const t = setTimeout(cb, ms);
  return () => clearTimeout(t);
};

export function createSupervisor(opts: {
  spawn: SpawnFn;
  now: () => number;
  serverExe: string;
  /** Opened at each clean stop, so a token set up meanwhile is picked up. */
  gameApi: () => Promise<GameApiAccess>;
  timer?: TimerFn;
}): Supervisor {
  const timer = opts.timer ?? defaultTimer;
  let current: ServerState = "stopped";
  let child: ChildHandle | undefined;
  let error: string | undefined;
  let restarts: number[] = [];
  let stopRequested = false;
  let stopping: Promise<StopOutcome> | undefined;
  let resolveStop: ((outcome: StopOutcome) => void) | undefined;
  let cancelShutdownTimer: (() => void) | undefined;
  /** "Stop anyway" pressed while the clean stop was still reading the token. */
  let forceRequested = false;
  /** This stop has turned into ending the process, so the clean sequence still awaiting the API must not go on. */
  let forced = false;
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
      finishStop("stopped");
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

  function finishStop(outcome: StopOutcome): void {
    cancelShutdownTimer?.();
    cancelShutdownTimer = undefined;
    forceRequested = false;
    const resolve = resolveStop;
    stopping = undefined;
    resolveStop = undefined;
    resolve?.(outcome);
  }

  function beginStopping(): void {
    stopRequested = true;
    forced = false;
    error = undefined;
    set("stopping");
  }

  /** Ends the process without saving. `note` says why in lastError() (none when it never got going). */
  function forceStop(note: string | undefined): void {
    if (!stopRequested) beginStopping();
    forced = true;
    // The 60 s wait is over: a late timer would overwrite this note with a different reason.
    cancelShutdownTimer?.();
    cancelShutdownTimer = undefined;
    error = note;
    child?.kill();
  }

  const ASKED = `${UNCLEAN_STOP}: ended without saving, as asked.`;
  const ANYWAY_HINT = '"Stop anyway" ends it without saving.';

  async function cleanStop(): Promise<void> {
    let access: GameApiAccess;
    try {
      access = await opts.gameApi();
    } catch (err) {
      access = { ok: false, reason: `The clean stop couldn't reach the game's API (${message(err)}).` };
    }
    const proc = child;
    // It ended (or crashed and restarted) while the token was read: there is nothing of ours left to stop cleanly.
    if (!proc || current !== "running") return finishStop(proc ? "failed" : "stopped");
    if (forceRequested) return forceStop(ASKED);
    if (!access.ok) {
      error = `${access.reason} The server is still running; ${ANYWAY_HINT}`;
      return finishStop("unavailable");
    }
    const api = access.api;
    beginStopping();
    try {
      await api.saveGame(await api.sessionName());
    } catch (err) {
      // An exit or "Stop anyway" meanwhile already settled the stop.
      if (child !== proc || forced) return;
      stopRequested = false;
      error = `The clean stop failed while saving, so the server is still running: ${message(err)}. ${ANYWAY_HINT}`;
      set("running");
      return finishStop("failed");
    }
    if (child !== proc || forced) return;
    let shutdownError: string | undefined;
    try {
      await api.shutdown();
    } catch (err) {
      // Saved already, so ending the process after the wait loses nothing: wait for it as if Shutdown worked.
      shutdownError = message(err);
    }
    if (child !== proc || forced) return;
    cancelShutdownTimer = timer(() => {
      if (child !== proc) return;
      error = `${UNCLEAN_STOP}: the server was still running ${SHUTDOWN_TIMEOUT_MS / 1000} s after Shutdown${
        shutdownError === undefined ? "" : ` (${shutdownError})`
      }, so it was ended.`;
      proc.kill();
    }, SHUTDOWN_TIMEOUT_MS);
  }

  function stop(stopOpts: StopOptions = {}): Promise<StopOutcome> {
    if (stopping) {
      if (stopOpts.anyway) {
        if (stopRequested) forceStop(ASKED);
        else forceRequested = true;
      }
      return stopping;
    }
    if (current === "stopped" || current === "crashed" || !child) return Promise.resolve("stopped");
    stopping = new Promise<StopOutcome>((resolve) => {
      resolveStop = resolve;
    });
    const result = stopping;
    // A process that hasn't spawned yet has no game to save.
    if (stopOpts.anyway) forceStop(ASKED);
    else if (current === "starting") forceStop(undefined);
    else void cleanStop();
    return result;
  }

  return {
    start,
    stop,
    async restart(restartOpts) {
      const outcome = await stop(restartOpts);
      if (outcome === "stopped") start();
      return outcome;
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
