import type { PowerCircuit, PowerCircuitStatus, PowerResponse } from "@satisfactory-dash/shared";
import { DataAge } from "../components/DataAge";
import { formatMW, formatMWh, formatPercent, formatTime, roundForDisplay } from "../format";

const STATUS_ORDER: Record<PowerCircuitStatus, number> = { outage: 0, at_risk: 1, ok: 2 };
const STATUS_LABEL: Record<PowerCircuitStatus, string> = {
  outage: "Outage: fuse tripped",
  at_risk: "At risk",
  ok: "OK",
};

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
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.circuitGroupId - b.circuitGroupId,
  );

  return (
    <section aria-labelledby="power-heading" className="panel">
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
              <CircuitCard circuit={circuit} />
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

function CircuitCard({ circuit }: { circuit: PowerCircuit }) {
  const tripped = circuit.fuseTriggered;
  // Capacity reads 0 while tripped, so the overload comparison means nothing then.
  const couldOverload = !tripped && circuit.maxConsumptionMW > circuit.capacityMW;

  return (
    <article aria-label={`Circuit ${circuit.circuitGroupId}`} className={`circuit circuit-${circuit.status}`}>
      <h4>
        Circuit {circuit.circuitGroupId} <span className="badge">{STATUS_LABEL[circuit.status]}</span>
      </h4>
      {tripped && <p>Reads 0 MW while the fuse is tripped.</p>}
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
      {couldOverload && <p className="warning">Could overload: peak demand is above capacity.</p>}
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
