import { createContext, useContext } from "react";
import type { ServerSummary } from "@satisfactory-dash/shared";

export const ServerContext = createContext<ServerSummary | null>(null);

/** The game server the operator is looking at. Only valid inside ServerGate. */
export function useSelectedServer(): ServerSummary {
  const server = useContext(ServerContext);
  if (!server) throw new Error("useSelectedServer must be used inside ServerGate");
  return server;
}

/** What the shell's server switcher needs from ServerGate, which owns the selection. */
export interface ServerSwitch {
  serverCount: number;
  /** Drops the selection, so ServerGate shows the picker again. */
  change: () => void;
}

export const ServerSwitchContext = createContext<ServerSwitch | null>(null);

export function useServerSwitch(): ServerSwitch {
  const serverSwitch = useContext(ServerSwitchContext);
  if (!serverSwitch) throw new Error("useServerSwitch must be used inside ServerGate");
  return serverSwitch;
}
