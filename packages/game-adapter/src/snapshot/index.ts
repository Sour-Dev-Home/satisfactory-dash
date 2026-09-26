/**
 * ADR-0031: the PURE SHAPE mapping from the adapter's domain types to the contract's parts (status, players, power
 * circuits, factory buildings), shared by the backend's telemetry services and the edge agent so the numbers users see
 * cannot drift between the two. Classification RULES (a machine's `state`, a circuit's `status`, `unit` lookups, the
 * counts) are not here: they stay in the backend so a rule change never needs an agent update.
 */
export { mapStatus } from "./statusMapper.js";
export { mapPlayers, readPlayers, isFrmAbsent } from "./playersMapper.js";
export { mapPowerCircuit } from "./powerMapper.js";
export type { MappedPowerCircuit } from "./powerMapper.js";
export { mapFactoryBuilding, isBackedUp } from "./factoryMapper.js";
export type { MappedFactoryBuilding } from "./factoryMapper.js";
