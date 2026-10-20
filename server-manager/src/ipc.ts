/**
 * The narrow bridge between the window and the main process: the preload exposes exactly `ServerManagerBridge` as
 * `window.serverManager`, and main answers only these channels. Nothing else crosses (no ipcRenderer, no Node).
 */
import type { ServerState } from "./supervisor";

export const CHANNELS = {
  getStatus: "sm:get-status",
  status: "sm:status",
  start: "sm:start",
  stop: "sm:stop",
  restart: "sm:restart",
  chooseServerDir: "sm:choose-server-dir",
  chooseSteamcmdDir: "sm:choose-steamcmd-dir",
} as const;

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
}

export type ChooseResult = { ok: true } | { ok: false; reason: "cancelled" | "missing-exe" | "busy" };

export interface ServerManagerBridge {
  getStatus(): Promise<Status>;
  onStatus(cb: (status: Status) => void): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  chooseServerDir(): Promise<ChooseResult>;
  chooseSteamcmdDir(): Promise<ChooseResult>;
}
