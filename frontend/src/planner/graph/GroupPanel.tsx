import { useEffect, useRef, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Bottleneck, PlannerNode } from "@satisfactory-dash/shared";
import { queries } from "../../api/queries";
import { useSelectedServer } from "../../servers/ServerContext";
import { BottleneckBadge } from "../BottleneckBadge";
import { groupLabel, nodeFindings, stateCountsText } from "../plannerText";
import { buildingIconUrl } from "./buildingIcons";
import { nodeFacts, withName } from "./graphModel";
import { joinMachines } from "./panelJoin";

/** Machines listed at most; a group can hold a thousand and the page is not the place to scroll them all. */
export const PANEL_MAX_MACHINES = 100;

/**
 * The side panel of ADR-0050 Decision 4: one group's machines (name, state, clock, actual over max), joined from the
 * Factory page's own read by the group's `machineIds` (the same cache entry), and the group's bottleneck badge with its
 * link to the Factory page. Focus moves in on open; Escape or Close hands it back through `onClose`.
 */
export function GroupPanel({
  id,
  node,
  facts = [],
  findings,
  onClose,
}: {
  id: string;
  node: PlannerNode;
  /** The factory view's further words for the group: its share split, where it stands, its storage chips. */
  facts?: readonly string[];
  findings: readonly Bottleneck[] | undefined;
  onClose: () => void;
}) {
  const server = useSelectedServer();
  const factory = useQuery(queries.factory(server.id));  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [node.key]);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };
  const joined = factory.data ? joinMachines(node, factory.data.data.buildings) : null;
  const shown = joined?.machines.slice(0, PANEL_MAX_MACHINES) ?? [];
  const icon = buildingIconUrl(node.className);
  const { recipe, outputs, loop } = nodeFacts(node);
  const label = groupLabel(withName(node));

  return (
    <aside id={id} aria-labelledby={`${id}-heading`} onKeyDown={onKeyDown} className="grid content-start gap-2 rounded-card border border-line p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon !== undefined && <img src={icon} alt="" width={64} height={64} className="size-building-icon shrink-0 rounded-card bg-icon-chip" />}
          <h5 id={`${id}-heading`} ref={heading} tabIndex={-1} className="m-0 break-words">
            {label}
          </h5>
        </div>
        <button type="button" onClick={onClose} className="min-h-touch shrink-0">
          Close
        </button>
      </div>
      <p className="m-0 text-sm">
        {node.count} {node.count === 1 ? "machine" : "machines"} · {stateCountsText(node.stateCounts)}
        {findings !== undefined && (
          <>
            {" · "}
            <BottleneckBadge count={nodeFindings(node, findings).length} what={label} />
          </>
        )}
      </p>
      {/* What the card no longer prints: the recipe, every output, the loop marker and the factory view's further words. */}
      <section aria-label={`About ${label}`} className="grid gap-1 text-sm">
        <p className="m-0">
          <span className="text-muted">Recipe: </span>
          {recipe}
        </p>
        <ul aria-label="Outputs" className="m-0 grid list-none gap-0.5 p-0">
          {outputs.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
        {loop && <p className="m-0">In a loop</p>}
        {facts.map((f) => (
          <p key={f} className="m-0">
            {f}
          </p>
        ))}
      </section>
      {factory.isError && !factory.data && <p className="m-0 text-sm">The machines could not be read. The Tables view still lists the group.</p>}
      {!factory.data && !factory.isError && <p className="m-0 text-sm text-muted">Reading machines…</p>}
      {joined && (
        <>
          <ul aria-label={`Machines in ${label}`} className="m-0 grid list-none gap-2 p-0">
            {shown.map((m) => (
              <li key={m.id} className="grid gap-0.5 break-words border-b border-line pb-2 text-sm">
                <span className="font-semibold">{m.name}</span>
                <span>
                  {m.state ?? "No state"}
                  {m.clock !== null && <span className="text-muted"> · {m.clock}</span>}
                </span>
                {m.outputs.length === 0 ? (
                  <span className="text-muted">No output data</span>
                ) : (
                  m.outputs.map((o) => <span key={o}>{o}</span>)
                )}
              </li>
            ))}
          </ul>
          {joined.machines.length > shown.length && (
            <p className="m-0 text-sm text-muted">
              {joined.machines.length - shown.length} more {joined.machines.length - shown.length === 1 ? "machine is" : "machines are"} not listed here.
            </p>
          )}
          {joined.missing > 0 && (
            <p className="m-0 text-sm text-muted">
              {joined.missing} {joined.missing === 1 ? "machine is" : "machines are"} not in the latest factory read.
            </p>
          )}
        </>
      )}
    </aside>
  );
}
