/** Pure helpers for the window: which buttons apply in which state, and how numbers read. */
import type { ChooseResult } from "../ipc";
import type { ServerState } from "../supervisor";

export function actionsFor(state: ServerState, configured: boolean): { start: boolean; stop: boolean; restart: boolean } {
  if (!configured) return { start: false, stop: false, restart: false };
  return {
    start: state === "stopped" || state === "crashed",
    stop: state === "starting" || state === "running",
    restart: state === "running",
  };
}

const DASH = "—";
const pad = (n: number) => String(n).padStart(2, "0");

export function formatUptime(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return DASH;
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return DASH;
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

export function formatCpu(percent: number | undefined): string {
  if (percent === undefined || !Number.isFinite(percent)) return DASH;
  return `${percent.toFixed(1)}%`;
}

export function chooseMessage(result: ChooseResult, which: "server" | "steamcmd"): string {
  if (result.ok || result.reason === "cancelled") return "";
  if (result.reason === "busy") return "Stop the server before changing its folder.";
  return which === "server"
    ? "That folder has no FactoryServer.exe. Choose the dedicated server's install folder."
    : "That folder has no steamcmd.exe. Choose the folder SteamCMD is installed in.";
}
