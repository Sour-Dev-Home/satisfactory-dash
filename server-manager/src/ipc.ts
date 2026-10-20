/**
 * The narrow bridge between the window and the main process: the preload exposes exactly `ServerManagerBridge` as
 * `window.serverManager`, and main answers only these channels. Nothing else crosses (no ipcRenderer, no Node).
 * The game's API token never does either: no channel returns it and no Status field holds it (`preload.test.ts`).
 */
import type { ServerState } from "./supervisor";

export const CHANNELS = {
  getStatus: "sm:get-status",
  status: "sm:status",
  start: "sm:start",
  stop: "sm:stop",
  restart: "sm:restart",
  update: "sm:update",
  updateLine: "sm:update-line",
  chooseServerDir: "sm:choose-server-dir",
  chooseSteamcmdDir: "sm:choose-steamcmd-dir",
} as const;

/** What a clean stop couldn't do and the window now offers to do without saving. */
export type AnywayAction = "stop" | "restart" | "update";

export interface ActionOptions {
  /** End the server without saving first ("Stop anyway"). */
  anyway?: boolean;
}

export interface Status {
  state: ServerState;
  lastError: string | undefined;
  /** A server an earlier session started and left running; Start stays off while it lives. */
  leftoverPid: number | undefined;
  /** False until a folder holding FactoryServer.exe is saved; the window then asks for one. */
  configured: boolean;
  serverDir: string | undefined;
  steamcmdDir: string | undefined;
  /** Since the process last reached `running`; undefined when it isn't running. */
  uptimeMs: number | undefined;
  cpuPercent: number | undefined;
  memoryBytes: number | undefined;
  /** Set when the last clean stop couldn't save; the window offers the action again without saving. */
  anyway: AnywayAction | undefined;
  /** An update (its stop, then SteamCMD) is in progress; Start, Stop and the folders wait for it. */
  updating: boolean;
  /** How the last update ended, until the next one starts. */
  updateResult: { ok: boolean; code: number } | undefined;
}

export type ChooseResult = { ok: true } | { ok: false; reason: "cancelled" | "missing-exe" | "busy" };

export interface ServerManagerBridge {
  getStatus(): Promise<Status>;
  onStatus(cb: (status: Status) => void): () => void;
  start(): Promise<void>;
  stop(opts?: ActionOptions): Promise<void>;
  restart(opts?: ActionOptions): Promise<void>;
  /** Stops the server cleanly if it runs (the window confirms first), then runs SteamCMD. */
  update(opts?: ActionOptions): Promise<void>;
  /** SteamCMD's output, a line at a time, while an update runs. */
  onUpdateLine(cb: (line: string) => void): () => void;
  chooseServerDir(): Promise<ChooseResult>;
  chooseSteamcmdDir(): Promise<ChooseResult>;
}

/** The renderer is untrusted: only a literal `{ anyway: true }` asks for an unclean stop. */
export function anywayRequested(arg: unknown): boolean {
  return typeof arg === "object" && arg !== null && (arg as { anyway?: unknown }).anyway === true;
}
