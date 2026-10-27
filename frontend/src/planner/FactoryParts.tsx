import { useMemo } from "react";
import type { Bottleneck, ProductionGraph } from "@satisfactory-dash/shared";
import { BottleneckBadge, BottleneckLine } from "./BottleneckBadge";
import { aggregateFlows, flowParts, factoryOfNode, type FactoryModel } from "./graph/hierarchy";
import {
  aggregateRateText,
  carrierWord,
  destinationChipText,
  factorySitesText,
  flowText,
  outputLine,
  siteFindings,
  stateCountsText,
} from "./plannerText";

/**
 * What a factory card and an opened factory both say (ADR-0055 Decision 6): machines and states, where it stands, what it
 * makes (actual over max), how many groups it shares with other factories and where its flows end. `detail` adds the
 * names of the remote sites it spans.
 */
export function FactoryFacts({
  model,
  findings,
  detail = false,
}: {
  model: FactoryModel;
  findings: readonly Bottleneck[] | undefined;
  detail?: boolean;
}) {
  const { factory } = model;
  const machines = factory.machineCount;
  return (
    <>
      <p className="m-0">
        {machines} {machines === 1 ? "machine" : "machines"} · {stateCountsText(model.stateCounts)}
        {detail && findings !== undefined && (
          <>
            {" · "}
            <BottleneckBadge count={siteFindings(model.nodes, findings).length} what={factory.name} />
          </>
        )}
      </p>
      <p className="m-0 break-words text-sm">
        Where: {factorySitesText(model)}
        {detail && model.remoteSites.length > 0 && ` (${model.remoteSites.map((s) => s.name).join(", ")})`}
      </p>
      {factory.products.length > 0 && (
        <ul aria-label={`Products of ${factory.name}`} className="m-0 grid list-none gap-0.5 p-0 text-sm">
          {factory.products.map((rate) => (
            <li key={rate.className} className="break-words">
              {outputLine(rate, model.stateCounts)}
            </li>
          ))}
        </ul>
      )}
      {factory.sharedNodeCount > 0 && (
        <p className="m-0 text-sm">
          {factory.sharedNodeCount} shared {factory.sharedNodeCount === 1 ? "group" : "groups"}, also feeding other factories
        </p>
      )}
      {model.destinations.length > 0 && (
        <ul aria-label={`Where ${factory.name} sends its output`} className="m-0 flex list-none flex-wrap gap-2 p-0 text-sm">
          {model.destinations.map((d) => (
            <li key={d.destination} className="rounded-card border border-line px-2 py-1">
              {destinationChipText(d.destination, d.count)}
            </li>
          ))}
        </ul>
      )}
      {!detail && <BottleneckLine count={findings === undefined ? undefined : siteFindings(model.nodes, findings).length} what={factory.name} />}
    </>
  );
}

/**
 * The flows from one factory to another (ADR-0055 Decision 6, "Edges between factories"): the belts, pipes and
 * transports between their groups summed by item and carrier, quality kept as the weakest part. Nothing is drawn when
 * the factories stand alone.
 */
export function FactoryFlows({ graph, models }: { graph: ProductionGraph; models: readonly FactoryModel[] }) {
  const flows = useMemo(() => {
    const owner = factoryOfNode(graph);
    return aggregateFlows(flowParts(graph), (key) => owner.get(key));
  }, [graph]);
  const names = useMemo(() => new Map(models.map((m) => [m.factory.key, m.factory.name])), [models]);
  if (flows.length === 0) return null;
  return (
    <section aria-labelledby="planner-flows-heading" className="grid gap-2">
      <h4 id="planner-flows-heading" className="m-0">
        Flows between factories
      </h4>
      <table>
        <thead>
          <tr>
            <th scope="col">From</th>
            <th scope="col">To</th>
            <th scope="col">Item</th>
            <th scope="col">Rate per minute</th>
            <th scope="col">Carrier</th>
            <th scope="col">Flow</th>
          </tr>
        </thead>
        <tbody>
          {flows.map((f, i) => (
            <tr key={`${i}|${f.from}|${f.to}|${f.itemClassName ?? ""}|${f.carrier}|${f.flow}`}>
              <th scope="row" className="break-words">
                {names.get(f.from) ?? "Factory not listed"}
              </th>
              <td data-label="To" className="break-words">
                {names.get(f.to) ?? "Factory not listed"}
              </td>
              <td data-label="Item" className="break-words">
                {f.itemName ?? f.itemClassName ?? "Item not inferred"}
                {f.mixed ? " (mixed belt)" : ""}
              </td>
              <td data-label="Rate">{aggregateRateText(f)}</td>
              <td data-label="Carrier">{carrierWord(f.carrier)}</td>
              <td data-label="Flow">{flowText(f.flow, undefined)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
