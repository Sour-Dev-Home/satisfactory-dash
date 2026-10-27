import type { PlannerNode } from "@satisfactory-dash/shared";
import { useDesignationChanges } from "./designationChanges";
import { popOutName, splitRequest } from "./designationOps";
import { PlanProblem } from "./designationText";
import { groupLabel } from "./plannerText";
import { splitMachines, staleAware, type SplitSource } from "./selectionPlans";
import { useRun } from "./useRun";

/**
 * ADR-0055 Decision 12: pops one group out of a designated factory into its own, named after it. No dialog; the undo offer
 * follows. `popOut` is undefined when the factory cannot be split (a viewer, a suggestion, an older backend).
 */
export function usePopOut(source: SplitSource | null, onStale: () => void) {
  const changes = useDesignationChanges();
  const { busy, error, run } = useRun();
  const popOut =
    source === null || changes === null
      ? undefined
      : (node: PlannerNode) =>
          void run(() =>
            staleAware(() => {
              const picked = splitMachines([node]);
              if (!picked.ok) throw new PlanProblem(picked.reason);
              const name = popOutName(node);
              const built = splitRequest({
                source: source.designation,
                memberBuildingIds: source.match.memberBuildingIds,
                machineIds: picked.machineIds,
                name,
                intent: "pop_out",
              });
              if (!built.ok) throw new PlanProblem(built.reason);
              return changes.apply(built, { message: `Popped ${groupLabel(node)} out into its own factory, ${name}.`, undoLabel: "Undo" });
            }, onStale),
          );
  return { popOut, busy, error };
}
