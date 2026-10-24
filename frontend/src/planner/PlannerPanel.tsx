import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { Bottleneck, PlannerEdge, PlannerNode, PlannerSite, ProductionGraphResponse } from "@satisfactory-dash/shared";
import { DataAge } from "../components/DataAge";
import { formatTime } from "../format";
import { Skeleton, SkeletonStatus } from "../ui/Skeleton";
import {
  BOTTLENECKS_LINK,
  bottleneckCountText,
  edgeCapacityText,
  edgeItemText,
  edgeRateText,
  groupLabel,
  nodeFindings,
  outputLine,
  plannerNotes,
  siteEdges,
  siteFindings,
  siteNodes,
  stateCountsText,
  totalMachines,
} from "./plannerText";

/** A bottleneck count that links to the Factory page's Bottlenecks section; "No bottlenecks" is plain text. */
function BottleneckBadge({ count, what }: { count: number; what: string }) {
  if (count === 0) return <span className="text-muted">{bottleneckCountText(0)}</span>;
  return (
    <Link to={BOTTLENECKS_LINK} aria-label={`${bottleneckCountText(count)} in ${what}, on the Factory page`} className="font-semibold text-warn">
      {bottleneckCountText(count)}
    </Link>
  );
}

function SiteCard({
  site,
  graph,
  findings,
  onOpen,
}: {
  site: PlannerSite;
  graph: ProductionGraphResponse["data"];
  findings: readonly Bottleneck[] | undefined;
  onOpen: () => void;
}) {
  const nodes = siteNodes(graph, site);
  return (
    <li className="grid content-start gap-2 rounded-card border border-line p-4">
      <h4 className="m-0 break-words">{site.name}</h4>
      <p className="m-0">
        {site.machineCount} {site.machineCount === 1 ? "machine" : "machines"} · {stateCountsText(site.stateCounts)}
      </p>
      {site.topOutputs.length > 0 && (
        <ul aria-label={`Top outputs of ${site.name}`} className="m-0 grid list-none gap-0.5 p-0 text-sm">
          {site.topOutputs.map((rate) => (
            <li key={rate.className} className="break-words">
              {outputLine(rate)}
            </li>
          ))}
        </ul>
      )}
      {/* Without the bottlenecks read there is nothing to count, so the line is left out rather than guessed. */}
      {findings !== undefined && (
        <p className="m-0 text-sm">
          <BottleneckBadge count={siteFindings(nodes, findings).length} what={site.name} />
        </p>
      )}
      <button type="button" onClick={onOpen} aria-label={`Open ${site.name}`} className="min-h-touch justify-self-start">
        Open site
      </button>
    </li>
  );
}

function GroupRow({ node, findings }: { node: PlannerNode; findings: readonly Bottleneck[] | undefined }) {
  const hits = nodeFindings(node, findings).length;
  return (
    <tr>
      <th scope="row" className="break-words">
        {node.name}
      </th>
      <td data-label="Count">{node.count}</td>
      <td data-label="Recipe" className="break-words">
        {node.recipe ?? "No recipe"}
      </td>
      <td data-label="Output">
        {node.products.length === 0 ? (
          <span className="text-muted">No output data</span>
        ) : (
          node.products.map((rate) => (
            <span key={rate.className} className="block break-words">
              {outputLine(rate)}
            </span>
          ))
        )}
      </td>
      <td data-label="States">{stateCountsText(node.stateCounts)}</td>
      <td data-label="Loop">{node.loop ? "In a loop" : "No"}</td>
      <td data-label="Bottlenecks">
        {findings === undefined ? <span className="text-muted">Not read</span> : <BottleneckBadge count={hits} what={groupLabel(node)} />}
      </td>
    </tr>
  );
}

function EdgeRow({ edge, nodes }: { edge: PlannerEdge; nodes: ReadonlyMap<string, PlannerNode> }) {
  const label = (key: string) => {
    const node = nodes.get(key);
    return node ? groupLabel(node) : "Group not listed";
  };
  const capacity = edgeCapacityText(edge);
  return (
    <tr>
      <th scope="row" className="break-words">
        {label(edge.from)}
      </th>
      <td data-label="To" className="break-words">
        {label(edge.to)}
      </td>
      <td data-label="Item" className="break-words">
        {edgeItemText(edge)}
      </td>
      <td data-label="Rate">{edgeRateText(edge)}</td>
      <td data-label="Capacity">{capacity ?? <span className="text-muted">Not known</span>}</td>
      <td data-label="Carrier">{edge.kind === "pipe" ? "Pipe" : "Belt"}</td>
    </tr>
  );
}

function SiteDetail({
  site,
  graph,
  findings,
  onBack,
}: {
  site: PlannerSite;
  graph: ProductionGraphResponse["data"];
  findings: readonly Bottleneck[] | undefined;
  onBack: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  // Opening a site replaces the cards, so focus follows to the new heading (as a page change does).
  useEffect(() => heading.current?.focus(), []);
  const nodes = siteNodes(graph, site);
  const edges = siteEdges(graph, nodes);
  const byKey = new Map(graph.nodes.map((n) => [n.key, n]));
  const count = siteFindings(nodes, findings).length;
  return (
    <div className="grid gap-3">
      <button type="button" onClick={onBack} className="min-h-touch justify-self-start">
        All sites
      </button>
      <h4 ref={heading} tabIndex={-1} id="planner-site-heading" className="m-0 break-words">
        {site.name}
      </h4>
      <p className="m-0">
        {site.machineCount} {site.machineCount === 1 ? "machine" : "machines"} · {stateCountsText(site.stateCounts)}
        {findings !== undefined && (
          <>
            {" · "}
            <BottleneckBadge count={count} what={site.name} />
          </>
        )}
      </p>

      <section aria-labelledby="planner-groups-heading" className="grid gap-2">
        <h5 id="planner-groups-heading" className="m-0">
          Groups
        </h5>
        {nodes.length === 0 ? (
          <p className="m-0">This site lists no machine groups.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Group</th>
                <th scope="col">Count</th>
                <th scope="col">Recipe</th>
                <th scope="col">Output, actual / max</th>
                <th scope="col">States</th>
                <th scope="col">Loop</th>
                <th scope="col">Bottlenecks</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => (
                <GroupRow key={node.key} node={node} findings={findings} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="planner-edges-heading" className="grid gap-2">
        <h5 id="planner-edges-heading" className="m-0">
          Connections
        </h5>
        {edges.length === 0 ? (
          <p className="m-0">No connections between this site&apos;s groups are known.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">Item</th>
                <th scope="col">Rate per minute</th>
                <th scope="col">Capacity</th>
                <th scope="col">Carrier</th>
              </tr>
            </thead>
            <tbody>
              {edges.map((edge) => (
                <EdgeRow key={`${edge.from}>${edge.to}>${edge.itemClassName ?? ""}>${edge.kind}`} edge={edge} nodes={byKey} />
              ))}
            </tbody>
          </table>
        )}
        <p className="m-0 text-sm text-muted">
          A rate with no word is measured. &quot;About&quot; is estimated from how machines share a belt. &quot;Unknown&quot; means the
          data cannot say.
        </p>
      </section>
    </div>
  );
}

/**
 * ADR-0050 Decision 4, the text form: a card per site (the overview) and, for one opened site, a table of its groups and
 * a table of its connections. Names come from the game server and are only ever text. Bottleneck counts come from the
 * Factory page's own read (`findings`, joined by building id); `undefined` means that read has not answered.
 */
export function PlannerPanel({
  snapshot,
  findings,
  findingsTruncated = false,
  refetchFailed = false,
  selected,
  onSelect,
}: {
  snapshot: ProductionGraphResponse;
  findings?: readonly Bottleneck[];
  findingsTruncated?: boolean;
  refetchFailed?: boolean;
  /** The opened site's key, or null for the overview. */
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const graph = snapshot.data;
  const site = selected === null ? undefined : graph.sites.find((s) => s.key === selected);
  const notes = plannerNotes(graph);
  const overviewHeading = useRef<HTMLHeadingElement>(null);
  // Back from a site: focus the overview's heading, but not on the page's first render.
  const [cameBack, setCameBack] = useState(false);
  useEffect(() => {
    if (cameBack && site === undefined) overviewHeading.current?.focus();
  }, [cameBack, site]);

  return (
    <section aria-labelledby="planner-heading" className="panel content-start">
      <h3 id="planner-heading" ref={overviewHeading} tabIndex={-1}>
        Production planner
      </h3>
      {snapshot.stale && <p>Showing last known planner data from {formatTime(snapshot.observedAt)}.</p>}

      {graph.sites.length === 0 ? (
        <p>
          {graph.beltData === "unsupported" || graph.beltData === "tooLarge"
            ? "No sites to show: the planner needs belt data, and this server has none to read."
            : "No sites yet: no machines are connected by conveyors."}
        </p>
      ) : site !== undefined ? (
        <SiteDetail
          key={site.key}
          site={site}
          graph={graph}
          findings={findings}
          onBack={() => {
            setCameBack(true);
            onSelect(null);
          }}
        />
      ) : (
        <>
          <p className="summary">
            {graph.sites.length} {graph.sites.length === 1 ? "site" : "sites"} · {totalMachines(graph.sites)} machines in {graph.nodes.length}{" "}
            {graph.nodes.length === 1 ? "group" : "groups"}
          </p>
          <ul aria-label="Sites" className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {graph.sites.map((s) => (
              <SiteCard
                key={s.key}
                site={s}
                graph={graph}
                findings={findings}
                onOpen={() => {
                  setCameBack(false);
                  onSelect(s.key);
                }}
              />
            ))}
          </ul>
        </>
      )}

      {(notes.length > 0 || findingsTruncated) && (
        <ul aria-label="Planner notes" className="m-0 grid list-none gap-1 break-words p-0 text-sm text-muted">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
          {findingsTruncated && <li>Bottleneck counts cover the Factory page&apos;s top findings only.</li>}
        </ul>
      )}

      <p className="as-of">
        <DataAge observedAt={snapshot.observedAt} late={snapshot.stale || refetchFailed} />
      </p>
    </section>
  );
}

/** The page while the graph loads: a heading bar, the summary line and a few cards, about the size of the loaded page. */
export function PlannerSkeleton() {
  return (
    <section aria-busy="true" className="panel content-start">
      <SkeletonStatus>Loading planner…</SkeletonStatus>
      <Skeleton className="h-lh w-48 text-xl" />
      <Skeleton className="h-5 w-full max-w-64" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
      <Skeleton className="h-lh w-56 text-sm" />
    </section>
  );
}
