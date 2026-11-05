import type { PlannerNode } from "@satisfactory-dash/shared";
import { useDesignationChanges } from "./designationChanges";
import { popOutName, splitRequest } from "./designationOps";
import { PlanProblem } from "./designationText";
import { groupLabel } from "./plannerText";
import { splitMachines, staleAware, type SplitSource } from "./selectionPlans";
import { useRun } from "./useRun";

/**
 * ADR-0055 Decision 12: pops one group out of a designated factory into its own, named after it. No dialog; the undo offer
 * follows. Both forms are undefined when the factory cannot be split (a viewer, a suggestion, an older backend).
 *
 * A failure shows beside the control that was used: `popOut` (an outline row) keeps its error here, for the page to show
 * as `error`; `write` returns the write's promise for a control that keeps its own error (the group panel).
 */
export function usePopOut(source: SplitSource | null, onStale: () => void) {
  const changes = useDesignationChanges();
  const { busy, error, run } = useRun();
  const write =
    source === null || changes === null
      ? undefined
      : (node: PlannerNode): Promise<void> =>
          staleAware(() => {
            const built = popOutRequest(source, node);
            if (!built.ok) throw new PlanProblem(built.reason);
            return changes.apply(built, { message: `Popped ${groupLabel(node)} out into its own factory, ${built.name}.`, undoLabel: "Undo" });
          }, onStale);
  const popOut = write === undefined ? undefined : (node: PlannerNode) => void run(() => write(node));
  // Offered only where it can work: a group with none of the factory's members (a storage card: designations hold the
  // Factory read's buildings only) or with all of them would only fail. A group too large to split whole keeps the
  // button, which says why.
  const canPopOut = (node: PlannerNode): boolean => source !== null && (!splitMachines([node]).ok || popOutRequest(source, node).ok);
  return { popOut, write, canPopOut, busy, error };
}

function popOutRequest(source: SplitSource, node: PlannerNode) {
  const picked = splitMachines([node]);
  if (!picked.ok) return picked;
  const name = popOutName(node);
  const built = splitRequest({
    source: source.designation,
    memberBuildingIds: source.match.memberBuildingIds,
    machineIds: picked.machineIds,
    name,
    intent: "pop_out",
  });
  return built.ok ? { ...built, name } : built;
}
