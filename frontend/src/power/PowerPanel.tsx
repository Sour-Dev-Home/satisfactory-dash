import { ownValue, type PowerCircuit, type PowerCircuitStatus, type PowerResponse } from "@satisfactory-dash/shared";
import { DataAge } from "../components/DataAge";
import { formatMW, formatMWh, formatPercent, formatTime, roundForDisplay } from "../format";
import { circuitAnchor, isCircuitAnchor } from "../lib/deepLinks";
import { useHashTarget } from "../lib/useHashTarget";

const STATUS_ORDER: Record<PowerCircuitStatus, number> = { outage: 0, at_risk: 1, ok: 2 };
const STATUS_LABEL: Record<PowerCircuitStatus, string> = {
  outage: "Outage: fuse tripped",
  at_risk: "At risk",
  ok: "OK",
};
/** A status this build doesn't know (a newer backend) sorts last, after ok (#368). */
const statusOrder = (status: string) => ownValue(STATUS_ORDER, status) ?? 3;

/**
 * Presentational: one power snapshot. Alarms come only from the backend's classification
 * (hasOutage, circuit.status); this component never re-derives them (power.ts).
 * `refetchFailed`: the last refresh failed, so this snapshot is what the cache kept.
 */
export function PowerPanel({ snapshot, refetchFailed = false }: { snapshot: PowerResponse; refetchFailed?: boolean }) {
  const { circuits, hasOutage } = snapshot.data;
  const outages = circuits.filter((c) => c.status === "outage").length;
  const atRisk = circuits.filter((c) => c.status === "at_risk").length;
  // Worst first; circuitGroupId only breaks ties within one response (never persisted).
  const ordered = [...circuits].sort(
    (a, b) => statusOrder(a.status) - statusOrder(b.status) || a.circuitGroupId - b.circuitGroupId,
  );
  // /app/power#circuit-3 (#351): scroll to that circuit's card once it's drawn.
  useHashTarget(isCircuitAnchor);

  return (
    // data-stale: dimmed while the game is unreachable and this is its last reading (ADR-0052; index.css).
    <section aria-labelledby="power-heading" className="panel" data-stale={snapshot.unreachableSince !== undefined ? "" : undefined}>
      <h3 id="power-heading">Power</h3>
      {hasOutage && (
        <p role="alert" className="banner banner-alarm">
          {/* hasOutage is the alarm; the count is detail, so never print "0 circuits". */}
          {outages > 0
            ? `Power outage: ${outages} ${outages === 1 ? "circuit has" : "circuits have"} a tripped fuse.`
            : "Power outage reported."}
        </p>
      )}
      {atRisk > 0 && (
        <p role="status" className="banner banner-warning">
          {atRisk} {atRisk === 1 ? "circuit is" : "circuits are"} at risk.
        </p>
      )}
      {snapshot.stale && <p>Showing last known power data from {formatTime(snapshot.observedAt)}.</p>}

      {circuits.length === 0 ? (
        <p>No power circuits yet.</p>
      ) : (
        <ul className="circuits">
          {ordered.map((circuit) => (
            <li key={circuit.circuitGroupId}>
              {/* ADR-0064: one healthy circuit needs no name on screen ("Circuit 0" says nothing then). */}
              <CircuitCard circuit={circuit} named={circuits.length > 1 || circuit.status !== "ok"} />
            </li>
          ))}
        </ul>
      )}

      <p className="as-of">
        <DataAge observedAt={snapshot.observedAt} late={snapshot.stale || refetchFailed} />
      </p>
    </section>
  );
}

/**
 * One circuit (ADR-0064): its load, consumption of capacity, and what is wrong; production and peak demand fold into
 * "Details". The status word shows only when it is not OK. `named`: false for the only circuit while it is OK, whose
 * heading is then for a screen reader only (the article keeps its name, and `#circuit-N` links still land on it).
 */
function CircuitCard({ circuit, named }: { circuit: PowerCircuit; named: boolean }) {
  const tripped = circuit.fuseTriggered;
  // Capacity reads 0 while tripped, so the overload comparison means nothing then.
  const couldOverload = !tripped && circuit.maxConsumptionMW > circuit.capacityMW;
  const label = circuit.status === "ok" ? null : (ownValue(STATUS_LABEL, circuit.status) ?? circuit.status);

  return (
    <article
      id={circuitAnchor(circuit.circuitGroupId)}
      aria-label={`Circuit ${circuit.circuitGroupId}`}
      className={`circuit circuit-${circuit.status}`}
    >
      <h4 className={named ? undefined : "sr-only"}>
        Circuit {circuit.circuitGroupId} {label !== null && <span className="badge">{label}</span>}
      </h4>
      {tripped && <p>Reads 0 MW while the fuse is tripped.</p>}
      <p className="mb-0" data-load="">
        <span className="font-semibold text-fg-strong">{formatMW(circuit.consumptionMW)}</span>
        <span className="text-muted"> of {formatMW(circuit.capacityMW)} capacity</span>
      </p>
      {couldOverload && <p className="warning">Could overload: peak demand is above capacity.</p>}
      <details className="text-sm">
        {/* A 44 px target: on a phone it is the only way to the readings (`ui-reviewer`). */}
        <summary className="flex min-h-touch cursor-pointer items-center text-muted">Details</summary>
        <dl>
          <dt>Production</dt>
          <dd>{formatMW(circuit.productionMW)}</dd>
          <dt>Consumption</dt>
          <dd>{formatMW(circuit.consumptionMW)}</dd>
          <dt>Capacity</dt>
          <dd>{formatMW(circuit.capacityMW)}</dd>
          <dt>Peak demand</dt>
          <dd>{formatMW(circuit.maxConsumptionMW)}</dd>
        </dl>
      </details>
      {circuit.batteryCapacityMWh > 0 && <Battery circuit={circuit} />}
    </article>
  );
}

function Battery({ circuit }: { circuit: PowerCircuit }) {
  // Label from the displayed value, so -0.03 MW reads "Idle", not "Discharging 0 MW".
  const flow = roundForDisplay(circuit.batteryDifferentialMW);
  return (
    <dl className="battery">
      <dt>Battery storage</dt>
      <dd>{formatMWh(circuit.batteryCapacityMWh)}</dd>
      <dt>Battery charge</dt>
      <dd>{formatPercent(circuit.batteryPercent)}</dd>
      <dt>Battery flow</dt>
      <dd>
        {flow > 0 ? `Charging ${formatMW(flow)}` : flow < 0 ? `Discharging ${formatMW(-flow)}` : "Idle"}
      </dd>
    </dl>
  );
}
