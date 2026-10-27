/**
 * The map module's public API (ADR-0014, ADR-0038 M3, #353): the map's world layers
 * (rails, resourceNodes — stored, latest only) and mapLive (trains, stations — read-through,
 * never stored). Reaches game data only through gameserver's facade (never the game-adapter
 * package directly) and resolves servers only through servers' index.ts.
 */
export { createWorldRoutes } from "./routes/worldRoutes.js";
export type { WorldRoutesDeps } from "./routes/worldRoutes.js";
export { createAgentWorldRouter } from "./routes/agentWorldRoutes.js";
export type { AgentWorldRoutesDeps } from "./routes/agentWorldRoutes.js";
export { WorldIngestService } from "./services/worldIngestService.js";
export type { WorldIngestBody, WorldIngestResult, WorldIngestPort } from "./services/worldIngestService.js";
export { MapLiveStore } from "./services/mapLiveStore.js";
export type { MapLiveSink, MapLiveReading } from "./services/mapLiveStore.js";
export { LocalWorldPoller, observeFactoryReads } from "./services/localWorldPoller.js";
export type { LocalWorldPollerPorts, LocalWorldPollerOptions } from "./services/localWorldPoller.js";
export { getLatestWorldLayer, upsertWorldLayerIfChanged, skipReasonOf } from "./repositories/worldLayerRepository.js";
export type { WorldLayerRow } from "./repositories/worldLayerRepository.js";
export { createDesignationRoutes, DESIGNATION_BODY_LIMIT, DESIGNATION_REPLACE_BODY_LIMIT } from "./routes/designationRoutes.js";
export type { DesignationRoutesDeps } from "./routes/designationRoutes.js";
export { createDbDesignationStore } from "./repositories/designationRepository.js";
export type { DesignationStore, CreateOutcome, UpdateOutcome } from "./repositories/designationRepository.js";
export { matchDesignations, findOverlap } from "./services/designationMatching.js";
export type { DesignationBuilding, DesignationMatch, MatchableDesignation } from "./services/designationMatching.js";
