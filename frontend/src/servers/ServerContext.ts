import { createContext, useContext } from "react";
import type { ServerSummary } from "@satisfactory-dash/shared";

export const ServerContext = createContext<ServerSummary | null>(null);

/** The game server the operator is looking at. Only valid inside ServerGate. */
export function useSelectedServer(): ServerSummary {
  const server = useContext(ServerContext);
  if (!server) throw new Error("useSelectedServer must be used inside ServerGate");
  return server;
}
