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
  // A genuine tripped fuse always wins, regardless of any other field's validity --
  // keep this strict-equality check ahead of the defensive block below so a NaN
  // elsewhere on a real outage can't get downgraded to at_risk.
  if (circuit.fuseTriggered === true) {
    return "outage";
  }
  // Defensive: rawTypes.ts only declares these fields' types via a compile-time `as`
  // cast (see the adapters-layer "unvalidated network responses" finding logged in
  // docs-vault/wiki/lessons-learned.md) -- nothing validates them at runtime. A
  // malformed fuseTriggered (e.g. the string "false", which is truthy in JS) would
  // otherwise misread via truthiness, and NaN numeric fields make every comparison
  // below silently false, falling through to "ok" -- the worst failure mode for
  // something meant to raise an alarm. [NEEDS VERIFICATION] whether FRM ever
  // actually sends malformed fields; treat as at_risk rather than assume either way.
  if (
    typeof circuit.fuseTriggered !== "boolean" ||
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

/** Coerces a value to a finite number, or `fallback` if it isn't one -- e.g. a
 *  string, NaN, or Infinity from unvalidated FRM data (see classifyPowerCircuit's
 *  doc comment). Keeps PowerCircuitResponse's `number` fields honest: without this,
 *  a NaN survives internally but silently becomes JSON `null` on the wire, and a
 *  malformed value the adapter is supposed to intercept could reach it unchanged. */
function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Coerces a value to a real boolean, or `fallback` if it isn't one -- e.g. the
 *  string "false" (truthy in JS) from unvalidated FRM data. */
function booleanOr(value: boolean, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export class PowerService {
  constructor(private readonly adapter: PowerAdapterLike) {}

  async getPowerOverview(): Promise<PowerOverviewResponse> {
    const circuits = await this.adapter.getPowerCircuits();
    const mapped: PowerCircuitResponse[] = circuits.map((circuit) => ({
      circuitGroupId: circuit.circuitGroupId,
      powerProduction: finiteOr(circuit.powerProduction, 0),
      powerConsumed: finiteOr(circuit.powerConsumed, 0),
      powerCapacity: finiteOr(circuit.powerCapacity, 0),
      fuseTriggered: booleanOr(circuit.fuseTriggered, false),
      batteryPercent: finiteOr(circuit.batteryPercent, 0),
      batteryDifferential: finiteOr(circuit.batteryDifferential, 0),
      // classifyPowerCircuit sees the RAW circuit, not these sanitized values, so a
      // malformed field still correctly forces at_risk rather than being laundered
      // into a clean-looking "0" and read as "ok".
      status: classifyPowerCircuit(circuit),
    }));
    return {
      circuits: mapped,
      hasOutage: mapped.some((circuit) => circuit.status === "outage"),
    };
  }
}
