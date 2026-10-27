import { useId, useMemo, useRef, useState } from "react";
import type { PlannerNode, ProductionGraph } from "@satisfactory-dash/shared";
import { useDesignationChanges } from "./designationChanges";
import { useDesignations } from "./DesignationContext";
import { mergeRequest, popOutName, proposedMergeName, splitRequest } from "./designationOps";
import { NameForm } from "./DesignationParts";
import { PlanProblem } from "./designationText";
import type { FactoryModel } from "./graph/hierarchy";
import { mergeSources, splitMachines, splitPartsNote, staleAware, type SplitSource } from "./selectionPlans";

const factories = (n: number) => `${n} ${n === 1 ? "factory" : "factories"}`;
const machines = (n: number) => `${n} ${n === 1 ? "machine" : "machines"}`;

/**
 * The overview's selection bar (ADR-0055 Decision 12, #727): "N factories selected" and Merge into one, which stays
 * disabled with its reason when the factories are not connected (the owner's "connected only, for now") or a cap would
 * be passed. Merge opens the name form in place (never a modal), proposing the largest factory's name.
 */
export function MergeBar({
  graph,
  picked,
  onClear,
  onStale,
}: {
  graph: ProductionGraph;
  picked: readonly FactoryModel[];
  onClear: () => void;
  onStale: () => void;
}) {
  const { designations, places } = useDesignations();
  const changes = useDesignationChanges();
  const [naming, setNaming] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const reasonId = useId();
  const sources = useMemo(() => mergeSources(graph, picked, designations?.designations, places), [graph, picked, designations, places]);
  if (changes === null) return null;
  if (naming && sources.ok) {
    return (
      <NameForm
        label="Name the merged factory"
        initial={proposedMergeName(sources.names)}
        save="Merge"
        onSave={(name) =>
          staleAware(() => {
            const built = mergeRequest({ designations: sources.designations, suggested: sources.suggested, name });
            if (!built.ok) throw new PlanProblem(built.reason);
            return changes.apply(built, { message: `Merged ${factories(picked.length)} into ${name}.`, undoLabel: "Split back" });
          }, onStale)
        }
        onClose={(saved) => {
          setNaming(false);
          if (saved) onClear();
          else queueMicrotask(() => opener.current?.focus());
        }}
      />
    );
  }
  return (
    <div role="group" aria-label="Selected factories" className="flex flex-wrap items-center gap-3">
      <span role="status" className="text-sm">
        {factories(picked.length)} selected
      </span>
      <button
        ref={opener}
        type="button"
        aria-disabled={!sources.ok}
        aria-describedby={sources.ok ? undefined : reasonId}
        onClick={() => sources.ok && setNaming(true)}
        className="min-h-touch"
      >
        Merge into one
      </button>
      <button type="button" onClick={onClear} className="min-h-touch">
        Clear selection
      </button>
      {!sources.ok && (
        <span id={reasonId} className="w-full text-sm text-muted sm:w-auto">
          {sources.reason}
        </span>
      )}
    </div>
  );
}

/**
 * Inside an opened designated factory: the picked groups (canvas picks or table ticks) become a new factory, "Split into
 * a new factory", named in place; one group proposes its own name (a pop-out). Members the matcher no longer finds stay
 * with the source.
 */
export function SplitBar({
  graph,
  model,
  source,
  nodes,
  onDone,
  onStale,
}: {
  graph: ProductionGraph;
  model: FactoryModel;
  source: SplitSource;
  nodes: readonly PlannerNode[];
  onDone: () => void;
  onStale: () => void;
}) {
  const changes = useDesignationChanges();
  const [naming, setNaming] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const count = nodes.reduce((sum, n) => sum + n.count, 0);
  const note = useMemo(() => splitPartsNote(graph, model, new Set(nodes.map((n) => n.key))), [graph, model, nodes]);
  if (changes === null) return null;
  const one = nodes.length === 1 ? nodes[0] : undefined;
  return naming ? (
    <NameForm
      label="Name the new factory"
      initial={one === undefined ? "" : popOutName(one)}
      save="Split"
      note={note}
      onSave={(name) =>
        staleAware(() => {
          const picked = splitMachines(nodes);
          if (!picked.ok) throw new PlanProblem(picked.reason);
          const built = splitRequest({
            source: source.designation,
            memberBuildingIds: source.match.memberBuildingIds,
            machineIds: picked.machineIds,
            name,
            intent: one === undefined ? "split" : "pop_out",
          });
          if (!built.ok) throw new PlanProblem(built.reason);
          const moved = built.request.put[1]?.members.length ?? 0;
          return changes.apply(built, { message: `Split ${machines(moved)} out of ${source.designation.name} into ${name}.`, undoLabel: "Undo" });
        }, onStale)
      }
      onClose={(saved) => {
        setNaming(false);
        if (saved) onDone();
        else queueMicrotask(() => opener.current?.focus());
      }}
    />
  ) : (
    <div role="group" aria-label="Split" className="flex flex-wrap items-center gap-3">
      <button ref={opener} type="button" disabled={nodes.length === 0} onClick={() => setNaming(true)} className="min-h-touch">
        Split into a new factory
      </button>
      <span role="status" className="text-sm text-muted">
        {nodes.length === 0
          ? "Tick groups to split them into a new factory."
          : `${nodes.length} ${nodes.length === 1 ? "group" : "groups"}, ${machines(count)} selected`}
      </span>
    </div>
  );
}
