import type { Power, PowerCircuit as PowerCircuitResponse } from "@satisfactory-dash/shared";
import type { PowerCircuit } from "../../gameserver/index.js";

export interface PowerAdapterLike {
  getPowerCircuits(): Promise<PowerCircuit[]>;
}

/** Battery percent below which a net-draining circuit counts as "at risk" rather
 *  than "ok". Not sourced from docs-vault — FRM's own DiscIT.Battery webhook config
 *  (docs-vault/raw-sources/frm-config.md) takes an arbitrary comma-separated list of
 *  thresholds rather than a single documented default, so this is our own choice,
 *  not a documented value. Adjust freely. BatteryPercent's 0-100 scale was verified
 *  live on 2026-09-22 (ADR-0006, docs-vault/wiki/frm-api.md). */
const AT_RISK_BATTERY_PERCENT = 20;

/**
 * Deterministic threshold check (ground rule 3, not an LLM call). Per
 * docs-vault/wiki/frm-api.md: only `FuseTriggered` is "a direct outage signal" —
 * over-capacity draw and draining batteries are described there as "heading toward
 * an outage," i.e. at_risk, not outage itself. A circuit whose batteries are still
 * covering a momentary deficit should warn, not false-alarm as an outage.
 * - "outage": the fuse has tripped.
 * - "at_risk": consumption exceeds capacity (batteries covering the gap, or about
 *   to brown out), OR batteries are net-draining (BatteryDifferential < 0, per
 *   docs-vault/raw-sources/frm-getPower.md: "Negative = Drains batteries") and
 *   below AT_RISK_BATTERY_PERCENT.
 * - "ok" otherwise.
 *
 * The battery-differential check runs even though `powerConsumed > powerCapacity`
 * is checked first, and it's a real, separate signal rather than dead code: circuit
 * has `PowerProduction`, `PowerConsumed`, and `PowerCapacity` as three distinct
 * fields (frm-getPower.md), and nothing in docs-vault says `PowerCapacity` tracks
 * *current* generation rather than generators' rated maximum. A generator sitting
 * idle or fuel-starved would show consumption comfortably under nominal capacity
 * while actual production has dropped below consumption, forcing a battery drain
 * this function would otherwise miss entirely. [NEEDS VERIFICATION] — whether this
 * gap is real depends on that undocumented relationship; until then, keep the
 * branch rather than assume it away in either direction.
 *
 * IMPORTANT (flagged by a review pass, not yet resolved): `hasOutage` rests
 * entirely on `FuseTriggered`. `getPower` returned `[]` in the Phase 2 spike and
 * has never been checked against a populated save, and docs-vault says nothing
 * about the fuse's latency/debounce, or whether it trips automatically on
 * over-capacity draw at all. A circuit massively over capacity with drained
 * batteries currently reports `hasOutage: false` until the fuse actually trips.
 * The docs-vault grounding supports this classification, but it's a conscious
 * choice worth someone signing off on once real `getPower` data exists.
 */
export function classifyPowerCircuit(circuit: PowerCircuit): PowerCircuitResponse["status"] {
  // A genuine tripped fuse always wins, regardless of any other field's validity --
  // keep this strict-equality check ahead of the defensive block below so a NaN
  // elsewhere on a real outage can't get downgraded to at_risk.
  if (circuit.fuseTriggered === true) {
    return "outage";
  }
  // Defense in depth: the adapter validates every field (adapters/rawSchemas.ts), so
  // this shouldn't fire. If a malformed value ever did slip through, a NaN would make
  // every comparison below silently false and fall through to "ok" -- the worst
  // failure mode for something meant to raise an alarm -- so fail toward at_risk.
  if (
    typeof circuit.fuseTriggered !== "boolean" ||
    !Number.isFinite(circuit.powerProduction) ||
    !Number.isFinite(circuit.powerConsumed) ||
    !Number.isFinite(circuit.powerCapacity) ||
    !Number.isFinite(circuit.batteryDifferential) ||
    !Number.isFinite(circuit.batteryPercent)
  ) {
    return "at_risk";
  }
  if (circuit.powerConsumed > circuit.powerCapacity) {
    return "at_risk";
  }
  if (circuit.batteryDifferential < 0 && circuit.batteryPercent < AT_RISK_BATTERY_PERCENT) {
    return "at_risk";
  }
  return "ok";
}

/**
 * Maps the adapter's circuits to the contract's Power (packages/shared/src/power.ts):
 * MW/MWh unit names, and the two fields that tell the frontend more than the old
 * shape did -- maxConsumptionMW ("could overload" when above capacity) and
 * batteryCapacityMWh (tells "0%" apart from "no batteries"). The adapter validates
 * every circuit, so there are no placeholder rows: a malformed getPower response is
 * a 502 upstream_invalid_response instead (contract rule, PR 3).
 */
export class PowerService {
  constructor(private readonly adapter: PowerAdapterLike) {}

  async getPowerOverview(): Promise<Power> {
    const circuits = await this.adapter.getPowerCircuits();
    const mapped: PowerCircuitResponse[] = circuits.map((circuit) => ({
      circuitGroupId: circuit.circuitGroupId,
      productionMW: circuit.powerProduction,
      consumptionMW: circuit.powerConsumed,
      capacityMW: circuit.powerCapacity,
      maxConsumptionMW: circuit.maxPowerConsumed,
      fuseTriggered: circuit.fuseTriggered,
      batteryCapacityMWh: circuit.batteryCapacity,
      batteryPercent: circuit.batteryPercent,
      batteryDifferentialMW: circuit.batteryDifferential,
      status: classifyPowerCircuit(circuit),
    }));
    return {
      circuits: mapped,
      hasOutage: mapped.some((circuit) => circuit.status === "outage"),
    };
  }
}
