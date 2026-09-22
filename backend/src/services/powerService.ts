import type { PowerCircuitResponse, PowerCircuitStatus, PowerOverviewResponse } from "@satisfactory-dash/shared";
import type { PowerCircuit } from "../adapters/domain.js";

export interface PowerAdapterLike {
  getPowerCircuits(): Promise<PowerCircuit[]>;
}

/** Battery percent below which a net-draining circuit counts as "at risk" rather
 *  than "ok". Not sourced from docs-vault — FRM's own DiscIT.Battery webhook config
 *  (docs-vault/raw-sources/frm-config.md) takes an arbitrary comma-separated list of
 *  thresholds rather than a single documented default, so this is our own choice,
 *  not a documented value. Adjust freely; it's not grounded in anything besides
 *  "seems reasonable." [NEEDS VERIFICATION] — this also assumes BatteryPercent is a
 *  0-100 scale; frm-getPower.md only documents it as "Float | Percentage of
 *  batteries" with no stated range, and every observed value so far (the doc's own
 *  example, this project's fixtures) has been 0. If FRM actually reports a 0-1
 *  fraction, this threshold is wrong and `at_risk` would fire on almost any drain. */
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
export function classifyPowerCircuit(circuit: PowerCircuit): PowerCircuitStatus {
  if (circuit.fuseTriggered) {
    return "outage";
  }
  if (circuit.powerConsumed > circuit.powerCapacity) {
    return "at_risk";
  }
  if (circuit.batteryDifferential < 0 && circuit.batteryPercent < AT_RISK_BATTERY_PERCENT) {
    return "at_risk";
  }
  return "ok";
}

export class PowerService {
  constructor(private readonly adapter: PowerAdapterLike) {}

  async getPowerOverview(): Promise<PowerOverviewResponse> {
    const circuits = await this.adapter.getPowerCircuits();
    const mapped: PowerCircuitResponse[] = circuits.map((circuit) => ({
      circuitGroupId: circuit.circuitGroupId,
      powerProduction: circuit.powerProduction,
      powerConsumed: circuit.powerConsumed,
      powerCapacity: circuit.powerCapacity,
      fuseTriggered: circuit.fuseTriggered,
      batteryPercent: circuit.batteryPercent,
      batteryDifferential: circuit.batteryDifferential,
      status: classifyPowerCircuit(circuit),
    }));
    return {
      circuits: mapped,
      hasOutage: mapped.some((circuit) => circuit.status === "outage"),
    };
  }
}
