import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import type { PlannerNode, ProductionGraph } from "@satisfactory-dash/shared";
import { useDesignationChanges } from "./designationChanges";
import { useDesignations } from "./DesignationContext";
import {
  NOTHING_TO_MOVE,
  groupRequest,
  mergeRequest,
  moveRequest,
  moveTargets,
  popOutName,
  proposedMergeName,
  splitRequest,
  type MoveTarget,
} from "./designationOps";
import { ErrorLine, NameForm } from "./DesignationParts";
import { PlanProblem } from "./designationText";
import type { TreeNode } from "./factoryTree";
import type { FactoryModel } from "./graph/hierarchy";
import {
  PARENTS_DO_NOT_MERGE,
  hierarchyPicks,
  mergeSources,
  splitMachines,
  splitPartsNote,
  staleAware,
  type MergeSources,
  type SplitSource,
} from "./selectionPlans";
import { useRun } from "./useRun";

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
  onCanvas = true,
  hierarchy,
}: {
  graph: ProductionGraph;
  picked: readonly FactoryModel[];
  onClear: () => void;
  onStale: () => void;
  /** The graph view is showing, where Select picks; in the Tables view the ticks do. */
  onCanvas?: boolean;
  /**
   * ADR-0061 Decision 6, behind `planner.nesting`: the picked cards as tree nodes (parents too) and the level's parent
   * designation (null at the top level). Given, the bar also offers Group into a new factory and Move to.
   */
  hierarchy?: { picked: readonly TreeNode[]; levelId: string | null } | undefined;
}) {
  const { designations, places } = useDesignations();
  const changes = useDesignationChanges();
  const [mode, setMode] = useState<"merge" | "group" | "move" | null>(null);
  const openers = useRef(new Map<string, HTMLButtonElement>());
  const reasonId = useId();
  const list = designations?.designations;
  const parentPicked = hierarchy !== undefined && hierarchy.picked.some((n) => n.kind !== "leaf");
  const sources = useMemo(
    (): MergeSources => (parentPicked ? { ok: false, reason: PARENTS_DO_NOT_MERGE } : mergeSources(graph, picked, list, places)),
    [graph, picked, list, places, parentPicked],
  );
  const tree = useMemo(() => (hierarchy === undefined ? undefined : hierarchyPicks(hierarchy.picked, list, places)), [hierarchy, list, places]);
  const grouping = useMemo((): { ok: true } | { ok: false; reason: string } | undefined => {
    if (hierarchy === undefined || tree === undefined) return undefined;
    if (!tree.ok) return tree;
    // Checked with a stand-in name and id, as the merge's caps are; the real ones go in on save.
    const trial = groupRequest({ all: list ?? [], picks: tree.picks, name: "Group", parentId: hierarchy.levelId, newId: STAND_IN_ID });
    return trial.ok ? { ok: true } : trial;
  }, [hierarchy, tree, list]);
  const targets = useMemo(
    () => (hierarchy === undefined || tree === undefined || !tree.ok ? [] : moveTargets(list ?? [], tree.picks, hierarchy.levelId)),
    [hierarchy, tree, list],
  );
  if (changes === null) return null;
  const moving: { ok: true } | { ok: false; reason: string } | undefined =
    hierarchy === undefined || tree === undefined
      ? undefined
      : !tree.ok
        ? tree
        : picked.length === 0
          ? { ok: false, reason: NOTHING_TO_MOVE }
          : targets.length === 0
            ? { ok: false, reason: NO_MOVE_TARGET }
            : { ok: true };
  const open = mode === "merge" ? sources.ok : mode === "group" ? grouping?.ok === true : mode === "move" ? moving?.ok === true : false;
  const close = (saved: boolean, from: string) => {
    setMode(null);
    if (saved) onClear();
    else queueMicrotask(() => openers.current.get(from)?.focus());
  };
  const opener = (key: string) => (el: HTMLButtonElement | null) => {
    if (el) openers.current.set(key, el);
    else openers.current.delete(key);
  };
  // Each disabled action says why in its own words; with the tree off only Merge's reason shows, as before ADR-0061.
  const reasons: { key: string; label: string; text: string }[] = [];
  if (!sources.ok && (hierarchy === undefined || picked.length > 0)) reasons.push({ key: "merge", label: "Merge", text: sources.reason });
  if (picked.length > 0 && grouping !== undefined && !grouping.ok) reasons.push({ key: "group", label: "Group", text: grouping.reason });
  if (picked.length > 0 && moving !== undefined && !moving.ok) reasons.push({ key: "move", label: "Move", text: moving.reason });
  const idle = hierarchy !== undefined && picked.length === 0;
  // Idle, every action is disabled for one reason: nothing is picked yet.
  const reasonOf = (key: string) => (idle ? `${reasonId}-idle` : reasons.some((r) => r.key === key) ? `${reasonId}-${key}` : undefined);
  // The bar stands from the first render, idle with nothing picked, so a pick fills it in place instead of pushing the
  // canvas down (no layout shift). Its count is one polite live region, mounted for the bar's life: the name form opens
  // below it, never in its place, so no announcement is dropped by a remount.
  return (
    <div role="group" aria-label="Selected factories" className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span role="status" aria-live="polite" className="text-sm">
          {picked.length === 0 ? `No factories selected: ${onCanvas ? "turn on Select above to pick some" : "tick some below"}` : `${factories(picked.length)} selected`}
        </span>
        {!open && (
          <>
            <button
              ref={opener("merge")}
              type="button"
              aria-disabled={!sources.ok}
              aria-describedby={reasonOf("merge")}
              onClick={() => sources.ok && setMode("merge")}
              className="min-h-touch"
            >
              Merge into one
            </button>
            {grouping !== undefined && (
              <button
                ref={opener("group")}
                type="button"
                aria-disabled={!grouping.ok}
                aria-describedby={reasonOf("group")}
                onClick={() => grouping.ok && setMode("group")}
                className="min-h-touch"
              >
                Group into a new factory
              </button>
            )}
            {moving !== undefined && (
              <button
                ref={opener("move")}
                type="button"
                aria-disabled={!moving.ok}
                aria-describedby={reasonOf("move")}
                onClick={() => moving.ok && setMode("move")}
                className="min-h-touch"
              >
                Move to…
              </button>
            )}
            <button type="button" disabled={picked.length === 0} onClick={onClear} className="min-h-touch">
              Clear selection
            </button>
            {/* Kept a line tall when there is no reason, so the reason coming and going does not move what is below. */}
            <span id={hierarchy === undefined ? `${reasonId}-merge` : undefined} className="min-h-5 w-full text-sm text-muted sm:w-auto">
              {hierarchy === undefined
                ? sources.ok
                  ? null
                  : sources.reason
                : idle
                  ? <span id={`${reasonId}-idle`}>Pick factories to merge, group or move them.</span>
                  : // One wrapping sentence per action, inline, so the line grows only as far as the words need.
                    reasons.map((r, i) => (
                      <span key={r.key} id={`${reasonId}-${r.key}`}>
                        {`${i > 0 ? " " : ""}${r.label}: ${r.text}`}
                      </span>
                    ))}
            </span>
          </>
        )}
      </div>
      {open && mode === "merge" && sources.ok && (
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
          onClose={(saved) => close(saved, "merge")}
        />
      )}
      {open && mode === "group" && hierarchy !== undefined && tree?.ok === true && (
        <NameForm
          label="Name the new factory"
          initial=""
          save="Group"
          note="The selected factories go inside it, here."
          onSave={(name) =>
            staleAware(() => {
              const built = groupRequest({ all: list ?? [], picks: tree.picks, name, parentId: hierarchy.levelId, newId: crypto.randomUUID() });
              if (!built.ok) throw new PlanProblem(built.reason);
              return changes.apply(built, { message: `Grouped ${factories(picked.length)} into ${name}.`, undoLabel: "Undo" });
            }, onStale)
          }
          onClose={(saved) => close(saved, "group")}
        />
      )}
      {open && mode === "move" && tree?.ok === true && (
        <MoveForm
          targets={targets}
          onMove={(target) =>
            staleAware(() => {
              const built = moveRequest({ all: list ?? [], picks: tree.picks, to: target.id });
              if (!built.ok) throw new PlanProblem(built.reason);
              const where = target.id === null ? "the top level" : target.label;
              return changes.apply(built, { message: `Moved ${factories(picked.length)} to ${where}.`, undoLabel: "Undo" });
            }, onStale)
          }
          onClose={(saved) => close(saved, "move")}
        />
      )}
    </div>
  );
}

/** A stand-in for the new parent's id while checking whether Group can be offered (never sent). */
const STAND_IN_ID = "00000000-0000-4000-8000-000000000000";
const NO_MOVE_TARGET = "There is nowhere else these factories can go.";

/**
 * Move to (ADR-0061 Decision 6): where the picked factories go, as a choice in place (never a modal). The choice takes
 * focus, Enter or Move sends, Escape cancels; a failure stays in the form with its reason.
 */
function MoveForm({ targets, onMove, onClose }: { targets: readonly MoveTarget[]; onMove: (target: MoveTarget) => Promise<unknown>; onClose: (saved: boolean) => void }) {
  const [choice, setChoice] = useState(0);
  const field = useRef<HTMLSelectElement>(null);
  const { busy, error, run } = useRun();
  useEffect(() => field.current?.focus(), []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const target = targets[choice];
    if (target !== undefined && (await run(() => onMove(target)))) onClose(true);
  };
  return (
    <form
      aria-label="Move the selected factories"
      onSubmit={(e) => void submit(e)}
      onKeyDown={(e) => e.key === "Escape" && onClose(false)}
      className="grid gap-2 rounded-card border border-line bg-surface-2 p-3"
    >
      <label className="grid gap-1 text-sm">
        Move to
        <select ref={field} value={choice} onChange={(e) => setChoice(Number(e.target.value))} className="min-h-touch">
          {targets.map((t, i) => (
            <option key={t.id ?? ""} value={i}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <ErrorLine error={error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="min-h-touch">
          Move
        </button>
        <button type="button" disabled={busy} onClick={() => onClose(false)} className="min-h-touch">
          Cancel
        </button>
      </div>
    </form>
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
  // As in the merge bar: the count stays one mounted live region while the name form is open below it.
  return (
    <div role="group" aria-label="Split" className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {!naming && (
          <button ref={opener} type="button" disabled={nodes.length === 0} onClick={() => setNaming(true)} className="min-h-touch">
            Split into a new factory
          </button>
        )}
        <span role="status" aria-live="polite" className="text-sm text-muted">
          {nodes.length === 0
            ? "Tick groups to split them into a new factory."
            : `${nodes.length} ${nodes.length === 1 ? "group" : "groups"}, ${machines(count)} selected`}
        </span>
      </div>
      {naming && (
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
      )}
    </div>
  );
}
