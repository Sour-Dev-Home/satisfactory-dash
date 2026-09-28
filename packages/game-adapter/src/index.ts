/**
 * @satisfactory-dash/game-adapter (ADR-0031 PR 2): everything that talks to ONE Satisfactory server (the vanilla
 * HTTPS API and FicsitRemoteMonitoring), extracted from the backend so the edge agent can reuse it. It has no Express,
 * no database and no environment access, and imports only `@satisfactory-dash/shared`, zod and node built-ins (a test
 * enforces that). The backend reaches it through `backend/src/modules/gameserver/index.ts`.
 */
export * from "./domain.js";
export { UpstreamError } from "./errors.js";
export type { RequestFailureKind } from "./errors.js";
export { createSatisfactoryServerConfig, DEFAULT_REQUEST_TIMEOUT_MS } from "./connection.js";
export type { SatisfactoryServerConfig, UpstreamCall, UpstreamCallListener } from "./connection.js";
export { SatisfactoryServerAdapter } from "./satisfactoryServerAdapter.js";
export type { VanillaApiClientLike, FrmApiClientLike } from "./satisfactoryServerAdapter.js";
// ADR-0038 M3 (#353): the map world-layer and mapLive reads' result shapes (`getRails`,
// `getResourceNodes`, `getTrains`, `getTrainStations` on the adapter), each with a `dropped` count
// for the conform-don't-reject rule. The backend reaches these through gameserver's facade.
export type { MappedRailSegments, MappedResourceNodes, MappedTrains, MappedTrainStations } from "./map/index.js";
export { testGameServerConnection } from "./connectionTest.js";
export type { ConnectionCheck, ConnectionCheckError, ConnectionTestResult } from "./connectionTest.js";
export { VanillaApiClient, VanillaApiRequestError, createVanillaApiTransport } from "./vanillaApiClient.js";
export type { VanillaApiTransport } from "./vanillaApiClient.js";
export { FrmApiClient, FrmApiRequestError } from "./frmApiClient.js";
export type { FrmApiFetch } from "./frmApiClient.js";
export { ServerOptionsAdapter } from "./serverOptionsAdapter.js";
export type { ServerOptionsPort, AutoPauseState } from "./serverOptionsAdapter.js";
export { createServerOptionsPort, createGameServerConnection } from "./factories.js";
export * from "./snapshot/index.js";
export * from "./map/index.js";
