import { createGameServerConnection, createSatisfactoryServerConfig, createServerOptionsPort, mapFactoryBuilding, mapPowerCircuit, mapStatus, readPlayers } from "@satisfactory-dash/game-adapter";
import type { ServerOptionsPort, SatisfactoryServerAdapter } from "@satisfactory-dash/game-adapter";
import type { GameReader } from "./sampler.js";

/**
 * The agent's window on the game (ADR-0031 PR 6): the game-adapter package's connection and options port, with the SAME shape
 * mappers the backend's services use (`mapStatus`, `mapPowerCircuit`, `mapFactoryBuilding`, `readPlayers`), so what the agent
 * sends is exactly what the backend would have built itself. It reads the game over loopback (or the machine's own network:
 * the store refuses any other host) and knows nothing about classification: no `state`, no `status`, no units (those are the
 * backend's rules, applied at ingest).
 */

export interface GameConnectionInput {
  host: string;
  apiPort: number;
  frmPort: number;
  /** The game's application token (server.GenerateAPIToken); needed for the auto-pause read and write. */
  apiToken: string;
  frmToken?: string;
}

/** The two collaborators the reader wraps: injectable so tests need no game. */
export interface GameReaderDeps {
  adapter: Pick<SatisfactoryServerAdapter, "getServerHealth" | "getServerStatus" | "getPowerCircuits" | "getFactoryBuildings" | "getPlayers">;
  options: ServerOptionsPort;
}

export function createGameReader(deps: GameReaderDeps): GameReader {
  const { adapter, options } = deps;
  return {
    async readStatus() {
      const [health, status] = await Promise.all([adapter.getServerHealth(), adapter.getServerStatus()]);
      return mapStatus(health, status);
    },
    async readPower() {
      return { circuits: (await adapter.getPowerCircuits()).map(mapPowerCircuit) };
    },
    async readFactory() {
      return { buildings: (await adapter.getFactoryBuildings()).map(mapFactoryBuilding) };
    },
    readPlayers: () => readPlayers(() => adapter.getPlayers()),
    // The value in force now; a change waiting for the next session start (`pending`) is not what the game is running.
    async readAutoPause() {
      return (await options.readAutoPause()).autoPause;
    },
    applyAutoPause: (enabled) => options.applyAutoPause(enabled),
  };
}

/** The real reader for one game server. */
export function connectToGame(input: GameConnectionInput): GameReader {
  const config = createSatisfactoryServerConfig({ host: input.host, apiPort: input.apiPort, apiToken: input.apiToken, frmPort: input.frmPort, frmToken: input.frmToken });
  return createGameReader({ adapter: createGameServerConnection(config), options: createServerOptionsPort(config) });
}
