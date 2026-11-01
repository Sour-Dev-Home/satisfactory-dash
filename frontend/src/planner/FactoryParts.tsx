import type { Bottleneck } from "@satisfactory-dash/shared";
import { BottleneckBadge, BottleneckLine } from "./BottleneckBadge";
import type { FactoryModel } from "./graph/hierarchy";
import { destinationChipText, factorySitesText, outputLine, siteFindings, stateCountsText } from "./plannerText";

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
              {outputLine(rate, model.stateCounts, model.atLeast?.has(rate.className) === true)}
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
