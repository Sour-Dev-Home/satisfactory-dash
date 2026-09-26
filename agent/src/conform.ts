import {
  AGENT_INPUT_MAX_BUILDINGS,
  AGENT_INPUT_MAX_CIRCUITS,
  AGENT_INPUT_MAX_PLAYERS,
  AGENT_INPUT_MAX_RATES_PER_BUILDING,
  AGENT_INPUT_MAX_STRING,
} from "@satisfactory-dash/shared";
import type { AgentFactory, AgentPower, ServerPlayersResponse, Status } from "@satisfactory-dash/shared";

/**
 * Keeps what the agent read inside the backend's INPUT BOUNDS before it sends it (ADR-0031). The backend REFUSES a body that
 * breaks a bound (a whole snapshot is lost to one bad value), so the agent, which knows the readings best, conforms them
 * first and never sends a body it knows will be refused:
 *  - a string longer than 200 characters is cut;
 *  - a list beyond its cap is cut (the first entries are kept);
 *  - a reading that cannot be negative is raised to 0 (float noise such as -0.0000001), a battery percent is held to 0..100
 *    (100.0000001 is noise), and a value that is not a finite number is DROPPED with the entry it belongs to (a circuit or a
 *    rate), because "unknown" is not "zero" (a 0 percent would read as an underfed machine).
 * Returns what to send and how many entries were cut or dropped, so the caller can log a count (never the entries).
 */

export interface Conformed<T> {
  value: T;
  /** Entries cut for the caps or dropped for a non-finite number. */
  adjusted: number;
}

const cut = (text: string): string => (text.length > AGENT_INPUT_MAX_STRING ? text.slice(0, AGENT_INPUT_MAX_STRING) : text);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const atLeastZero = (value: number): number => (value < 0 ? 0 : value);
const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

/** A yaw into the contract's [0, 360). Float noise such as -1e-20 would land on exactly 360, so that goes to 0. */
const normalizeYaw = (degrees: number): number => {
  const yaw = ((degrees % 360) + 360) % 360;
  return yaw >= 360 ? 0 : yaw;
};

/**
 * A status number that is not finite has no honest value ("unknown is not zero"), so it throws and the sampler reports the game
 * as unreachable for this pass; a finite one is raised to 0 (noise) and a count is rounded to a whole number.
 */
export function conformStatus(status: Status): Status {
  const numbers = [status.connectedPlayers, status.playerLimit, status.tickRate, status.totalGameDurationSeconds];
  if (!numbers.every(finite)) throw new RangeError("a status reading is not a finite number");
  return {
    ...status,
    sessionName: cut(status.sessionName),
    connectedPlayers: atLeastZero(Math.round(status.connectedPlayers)),
    playerLimit: atLeastZero(Math.round(status.playerLimit)),
    tickRate: atLeastZero(status.tickRate),
    totalGameDurationSeconds: atLeastZero(status.totalGameDurationSeconds),
  };
}

export function conformPlayers(players: ServerPlayersResponse): Conformed<ServerPlayersResponse> {
  const kept = players.players.slice(0, AGENT_INPUT_MAX_PLAYERS);
  return { value: { available: players.available, players: kept.map((player) => ({ name: cut(player.name), online: player.online })) }, adjusted: players.players.length - kept.length };
}

export function conformPower(power: AgentPower): Conformed<AgentPower> {
  let adjusted = Math.max(0, power.circuits.length - AGENT_INPUT_MAX_CIRCUITS);
  const circuits: AgentPower["circuits"] = [];
  for (const circuit of power.circuits.slice(0, AGENT_INPUT_MAX_CIRCUITS)) {
    const numbers = [circuit.productionMW, circuit.consumptionMW, circuit.capacityMW, circuit.maxConsumptionMW, circuit.batteryCapacityMWh, circuit.batteryPercent, circuit.batteryDifferentialMW];
    if (!numbers.every(finite) || !Number.isInteger(circuit.circuitGroupId)) {
      adjusted += 1;
      continue;
    }
    circuits.push({
      circuitGroupId: circuit.circuitGroupId,
      productionMW: atLeastZero(circuit.productionMW),
      consumptionMW: atLeastZero(circuit.consumptionMW),
      capacityMW: atLeastZero(circuit.capacityMW),
      maxConsumptionMW: atLeastZero(circuit.maxConsumptionMW),
      fuseTriggered: circuit.fuseTriggered,
      batteryCapacityMWh: atLeastZero(circuit.batteryCapacityMWh),
      batteryPercent: clampPercent(circuit.batteryPercent),
      batteryDifferentialMW: circuit.batteryDifferentialMW,
    });
  }
  return { value: { circuits }, adjusted };
}

type Building = AgentFactory["buildings"][number];
type Rate = Building["production"][number];

export function conformFactory(factory: AgentFactory): Conformed<AgentFactory> {
  let adjusted = Math.max(0, factory.buildings.length - AGENT_INPUT_MAX_BUILDINGS);
  const conformRates = (rates: readonly Rate[]): Rate[] => {
    const out: Rate[] = [];
    for (const rate of rates.slice(0, AGENT_INPUT_MAX_RATES_PER_BUILDING)) {
      if (![rate.currentPerMinute, rate.maxPerMinute, rate.percent].every(finite)) {
        adjusted += 1;
        continue;
      }
      out.push({ name: cut(rate.name), className: cut(rate.className), currentPerMinute: atLeastZero(rate.currentPerMinute), maxPerMinute: atLeastZero(rate.maxPerMinute), percent: atLeastZero(rate.percent) });
    }
    adjusted += Math.max(0, rates.length - AGENT_INPUT_MAX_RATES_PER_BUILDING);
    return out;
  };
  const buildings: Building[] = factory.buildings.slice(0, AGENT_INPUT_MAX_BUILDINGS).map((building) => ({
    id: cut(building.id),
    name: cut(building.name),
    className: cut(building.className),
    recipe: building.recipe === null ? null : cut(building.recipe),
    isProducing: building.isProducing,
    isPaused: building.isPaused,
    isBackedUp: building.isBackedUp,
    ...(building.circuitGroupId !== undefined && Number.isInteger(building.circuitGroupId) ? { circuitGroupId: building.circuitGroupId } : {}),
    ...(building.location !== undefined && [building.location.xM, building.location.yM, building.location.zM, building.location.rotationDeg].every(finite) ? { location: { ...building.location, rotationDeg: normalizeYaw(building.location.rotationDeg) } } : {}),
    ...(building.clockSpeedPercent !== undefined && finite(building.clockSpeedPercent) ? { clockSpeedPercent: atLeastZero(building.clockSpeedPercent) } : {}),
    production: conformRates(building.production),
    ...(building.ingredients !== undefined ? { ingredients: conformRates(building.ingredients) } : {}),
  }));
  return { value: { buildings }, adjusted };
}
