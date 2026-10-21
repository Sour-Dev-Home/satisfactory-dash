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
  /** Selects a server by id (e.g. the one the player just added). */
  select: (serverId: string) => void;
  /** After leaving a server (ADR-0047): drops the selection like `change`, and says "You left {name}." where it lands. */
  left: (serverName: string) => void;
  /** The server just left, while that confirmation shows; null otherwise. */
  leftName: string | null;
  /** Ends that confirmation (the person moved on). */
  clearLeft: () => void;
}

export const ServerSwitchContext = createContext<ServerSwitch | null>(null);

export function useServerSwitch(): ServerSwitch {
  const serverSwitch = useContext(ServerSwitchContext);
  if (!serverSwitch) throw new Error("useServerSwitch must be used inside ServerGate");
  return serverSwitch;
}
