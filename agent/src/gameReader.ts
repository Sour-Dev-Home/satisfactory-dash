import { createGameServerConnection, createSatisfactoryServerConfig, createServerOptionsPort, mapFactoryBuilding, mapPowerCircuit, mapStatus, readPlayers } from "@satisfactory-dash/game-adapter";
import type { ServerOptionsPort, SatisfactoryServerAdapter } from "@satisfactory-dash/game-adapter";
import type { GameReader } from "./sampler.js";
import type { WorldPorts } from "./worldReader.js";

/**
 * The agent's window on the game (ADR-0031 PR 6): the game-adapter package's connection and options port, with the SAME shape
 * mappers the backend's services use (`mapStatus`, `mapPowerCircuit`, `mapFactoryBuilding`, `readPlayers`, the trains and
 * stations mappers behind `getTrains`/`getTrainStations`), so what the agent
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
  adapter: Pick<SatisfactoryServerAdapter, "getServerHealth" | "getServerStatus" | "getPowerCircuits" | "getFactoryBuildings" | "getPlayers" | "getTrains" | "getTrainStations" | "getRails" | "getResourceNodes" | "getConveyors" | "getTrainRoutes">;
  options: ServerOptionsPort;
}

/** The snapshot reads and, from the same connection, the world ports the world reader uses (ADR-0038 M4). */
export interface AgentGame extends GameReader {
  world: WorldPorts;
}

export function createGameReader(deps: GameReaderDeps): AgentGame {
  const { adapter, options } = deps;
  return {
    // The adapter's projections, the same ones the backend's local world poller reads; read only when the world reader asks.
    world: {
      getRails: () => adapter.getRails(),
      getResourceNodes: () => adapter.getResourceNodes(),
      getConveyors: () => adapter.getConveyors(),
      getTrainRoutes: () => adapter.getTrainRoutes(),
    },
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
    // ADR-0038 step 5: the adapter's projections (the same ones the backend's local poller reads); one failing read fails both.
    async readMapLive() {
      const [trains, stations] = await Promise.all([adapter.getTrains(), adapter.getTrainStations()]);
      return { trains: trains.data, stations: stations.data, dropped: trains.dropped + stations.dropped };
    },
    // The value in force now; a change waiting for the next session start (`pending`) is not what the game is running.
    async readAutoPause() {
      return (await options.readAutoPause()).autoPause;
    },
    applyAutoPause: (enabled) => options.applyAutoPause(enabled),
  };
}

/** The real reader for one game server: one config and one connection serve the snapshot reads and the world ports. */
export function connectToGame(input: GameConnectionInput): AgentGame {
  const config = createSatisfactoryServerConfig({ host: input.host, apiPort: input.apiPort, apiToken: input.apiToken, frmPort: input.frmPort, frmToken: input.frmToken });
  return createGameReader({ adapter: createGameServerConnection(config), options: createServerOptionsPort(config) });
}
