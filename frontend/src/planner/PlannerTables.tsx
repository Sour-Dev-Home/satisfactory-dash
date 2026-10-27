import { useState } from "react";
import type { Bottleneck, PlannerNode } from "@satisfactory-dash/shared";
import { BottleneckBadge } from "./BottleneckBadge";
import {
  extractorOutput,
  groupsExtractorOutput,
  INFERRED_FROM_NODE,
  isStaleNode,
  makesNothing,
  minedLine,
  NO_OUTPUT_DATA,
  noRecipeCellText,
  recipeText,
  STALE_NODE_NOTE,
  type MinedOutput,
  type MinedRate,
} from "./graph/graphModel";
import { bubblesOf, foldBubbles, shareSplit, type Bubble, type ConnectionRow, type Remote } from "./graph/hierarchy";
import {
  bubbleTitle,
  carrierText,
  edgeCapacityText,
  edgeItemText,
  flowText,
  foldText,
  groupLabel,
  itemFromText,
  mergeStateCounts,
  nodeFindings,
  outputLine,
  rateText,
  remoteText,
  roleText,
  shareText,
  stateCountsText,
} from "./plannerText";

/** Which groups are ticked for "Designate selected" (ADR-0055 Decision 5); absent when the viewer cannot designate. */
export interface GroupSelection {
  selected: ReadonlySet<string>;
  toggle: (nodeKey: string) => void;
  /** ADR-0055 Decision 12: in a designated factory that can be split, a row's "Pop out" moves the group into its own. */
  popOut?: ((node: PlannerNode) => void) | undefined;
  popOutBusy?: boolean;
}

/** What the Groups table knows beyond the groups when it lists one factory. */
export interface FactoryColumns {
  remote: ReadonlyMap<string, Remote>;
  /** Factory key to name, for the split of a shared group. */
  nameOf: ReadonlyMap<string, string>;
}

type Rates = ReadonlyMap<string, MinedRate | null> | undefined;

/**
 * An extractor's guessed resource and the rate its links carry ("rate not read" without one), then the muted "(inferred
 * from the node)"; or the honest "Resource not identified".
 */
function Mined({ mined }: { mined: MinedOutput }) {
  if (!mined.inferred) return <span className={mined.rate === null ? "text-muted" : "break-words"}>{minedLine(mined)}</span>;
  return (
    <>
      <span className="block break-words">{minedLine(mined)}</span>
      <span className="block text-sm text-muted">{INFERRED_FROM_NODE}</span>
    </>
  );
}

/** #728 cause 11: a group built from conveyor data older than the factory read says so, muted, in place of its outputs. */
const StaleNote = () => <span className="block break-words text-muted">{STALE_NODE_NOTE}</span>;

function Outputs({ node, rates }: { node: PlannerNode; rates: Rates }) {
  if (isStaleNode(node)) return <StaleNote />;
  const mined = extractorOutput(node, rates);
  if (mined !== null) return <Mined mined={mined} />;
  if (node.products.length === 0) return makesNothing(node) ? null : <span className="text-muted">{NO_OUTPUT_DATA}</span>;
  return node.products.map((rate) => (
    <span key={rate.className} className="block break-words">
      {outputLine(rate, node.stateCounts)}
    </span>
  ));
}

function GroupRow({
  node,
  findings,
  bubble,
  nested,
  factory,
  selection,
  rates,
}: {
  node: PlannerNode;
  findings: readonly Bottleneck[] | undefined;
  bubble: Bubble;
  nested: boolean;
  factory: FactoryColumns | undefined;
  selection: GroupSelection | undefined;
  rates: Rates;
}) {
  const hits = nodeFindings(node, findings).length;
  const role = roleText(node.role);
  // A group alone in its bubble carries the tree's ordinal itself; in a bigger bubble the bubble's row says it.
  const tree = !nested && bubble.of > 1 ? `tree ${bubble.ordinal} of ${bubble.of}` : null;
  const remote = factory?.remote.get(node.key);
  const split = factory === undefined ? null : shareSplit(node);
  const recipe = recipeText(node);
  return (
    <tr>
      <th scope="row" className={nested ? "break-words ps-6" : "break-words"}>
        {node.name}
        {(role !== null || tree !== null) && <span className="block text-sm font-normal text-muted">{[role, tree].filter(Boolean).join(" · ")}</span>}
      </th>
      <td data-label="Count">{node.count}</td>
      <td data-label="Recipe" className="break-words">
        {recipe ?? <span className="text-muted">{noRecipeCellText(node)}</span>}
      </td>
      <td data-label="Output">
        <Outputs node={node} rates={rates} />
      </td>
      <td data-label="States">{stateCountsText(node.stateCounts)}</td>
      <td data-label="Loop">{node.loop ? "In a loop" : "No"}</td>
      <td data-label="Bottlenecks">
        {findings === undefined ? <span className="text-muted">Not read</span> : <BottleneckBadge count={hits} what={groupLabel(node)} />}
      </td>
      {factory !== undefined && (
        <td data-label="Place and split" className="break-words">
          {remote === undefined && split === null ? (
            <span className="text-muted">Home site</span>
          ) : (
            <>
              {remote !== undefined && <span className="block">{remoteText(remote)}</span>}
              {split !== null && <span className="block">Shared: {shareText(split, factory.nameOf)}</span>}
            </>
          )}
        </td>
      )}
      {selection !== undefined && (
        <td data-label="Select">
          <label className="inline-flex min-h-touch items-center gap-2">
            <input type="checkbox" className="size-5" checked={selection.selected.has(node.key)} onChange={() => selection.toggle(node.key)} />
            <span className="sr-only">Select {node.name}</span>
          </label>
          {selection.popOut !== undefined && (
            <button
              type="button"
              disabled={selection.popOutBusy === true}
              aria-label={`Pop out ${groupLabel(node)}`}
              onClick={() => selection.popOut?.(node)}
              className="ms-2 min-h-touch"
            >
              Pop out
            </button>
          )}
        </td>
      )}
    </tr>
  );
}

function BubbleBody({
  bubble,
  findings,
  factory,
  selection,
  columns,
  rates,
}: {
  bubble: Bubble;
  findings: readonly Bottleneck[] | undefined;
  factory: FactoryColumns | undefined;
  selection: GroupSelection | undefined;
  columns: number;
  rates: Rates;
}) {
  // A bubble of one group is just its row; a bigger one gets a row that names it, and its groups are indented under it.
  const nested = bubble.nodes.length > 1;
  const mined = bubble.products.length === 0 ? groupsExtractorOutput(bubble.nodes, rates) : null;
  return (
    <tbody>
      {nested && (
        <tr>
          <th scope="rowgroup" className="break-words">
            {bubbleTitle(bubble)}
          </th>
          <td colSpan={columns - 1} className="break-words">
            {bubble.nodes.every(isStaleNode) ? (
              <StaleNote />
            ) : mined !== null ? (
              <Mined mined={mined} />
            ) : bubble.products.length === 0 ? (
              bubble.nodes.every(makesNothing) ? null : <span className="text-muted">{NO_OUTPUT_DATA}</span>
            ) : (
              bubble.products.map((rate) => (
                <span key={rate.className} className="block">
                  {outputLine(rate, mergeStateCounts(bubble.nodes.map((n) => n.stateCounts)))}
                </span>
              ))
            )}
          </td>
        </tr>
      )}
      {bubble.nodes.map((node) => (
        <GroupRow key={node.key} node={node} findings={findings} bubble={bubble} nested={nested} factory={factory} selection={selection} rates={rates} />
      ))}
    </tbody>
  );
}

/**
 * The groups of a site or a factory, one bubble at a time (ADR-0053 Decision 3: a recipe from one source tree), each
 * bubble's groups indented under it. Trees of one recipe beyond the fold cap sit behind one button.
 */
export function GroupsTable({
  nodes,
  findings,
  factory,
  selection,
  rates,
}: {
  nodes: readonly PlannerNode[];
  findings: readonly Bottleneck[] | undefined;
  factory?: FactoryColumns;
  selection?: GroupSelection;
  /** `minedRates` of the graph's edges: an extractor's rate. */
  rates?: ReadonlyMap<string, MinedRate | null>;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const entries = foldBubbles(bubblesOf(nodes));
  const columns = (factory === undefined ? 7 : 8) + (selection === undefined ? 0 : 1);
  return (
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
          {factory !== undefined && <th scope="col">Place and split</th>}
          {selection !== undefined && <th scope="col">Select</th>}
        </tr>
      </thead>
      {entries.flatMap((entry) => {
        if (entry.type === "bubble") return [<BubbleBody key={entry.bubble.key} bubble={entry.bubble} findings={findings} factory={factory} selection={selection} columns={columns} rates={rates} />];
        const shown = open.has(entry.key);
        const toggle = (
          <tbody key={entry.key}>
            <tr>
              <th scope="rowgroup" colSpan={columns}>
                <button
                  type="button"
                  aria-expanded={shown}
                  className="min-h-touch"
                  onClick={() =>
                    setOpen((prev) => {
                      const next = new Set(prev);
                      if (!next.delete(entry.key)) next.add(entry.key);
                      return next;
                    })
                  }
                >
                  {shown ? "Hide" : "Show"} {foldText(entry)}
                </button>
              </th>
            </tr>
          </tbody>
        );
        return shown
          ? [toggle, ...entry.bubbles.map((b) => <BubbleBody key={b.key} bubble={b} findings={findings} factory={factory} selection={selection} columns={columns} rates={rates} />)]
          : [toggle];
      })}
    </table>
  );
}

/**
 * The connections touching a site or a factory: belts, pipes and transports in one table. `labelOf` names an end (and
 * says which other factory it belongs to).
 */
export function ConnectionsTable({ rows, labelOf }: { rows: readonly ConnectionRow[]; labelOf: (nodeKey: string) => string }) {
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">From</th>
          <th scope="col">To</th>
          <th scope="col">Item</th>
          <th scope="col">Rate per minute</th>
          <th scope="col">Capacity</th>
          <th scope="col">Carrier</th>
          <th scope="col">Flow</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const capacity = row.capacityPerMinute === null ? null : edgeCapacityText({ kind: row.carrier === "pipe" ? "pipe" : "belt", capacityPerMinute: row.capacityPerMinute });
          const how = itemFromText(row.itemFrom);
          return (
            <tr key={`${i}|${row.key}`}>
              <th scope="row" className="break-words">
                {labelOf(row.from)}
              </th>
              <td data-label="To" className="break-words">
                {labelOf(row.to)}
              </td>
              <td data-label="Item" className="break-words">
                {edgeItemText(row)}
                {how !== null && row.itemClassName !== null && <span className="block text-sm text-muted">({how})</span>}
              </td>
              <td data-label="Rate">{rateText(row.rate, row.ratePerMinute, row.unit)}</td>
              <td data-label="Capacity">{capacity ?? <span className="text-muted">Not known</span>}</td>
              <td data-label="Carrier" className="break-words">
                {carrierText(row)}
              </td>
              <td data-label="Flow" className="break-words">
                {flowText(row.flow, row.destination)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
