import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PlannerNode } from "@satisfactory-dash/shared";
import { DANGER_BUTTON, DANGER_BUTTON_QUIET } from "../components/dangerButton";
import { useDesignationChanges } from "./designationChanges";
import { useDesignations } from "./DesignationContext";
import { membersOf } from "./designationMatch";
import { dissolveRequest } from "./designationOps";
import { useRun } from "./useRun";
import { ALL_MISSING_TEXT, PlanProblem, claimedText, designationErrorText, missingText, nameProblem } from "./designationText";
import type { FactoryModel } from "./graph/hierarchy";

const textOf = (error: unknown) => (error instanceof PlanProblem ? error.message : designationErrorText(error));

export function ErrorLine({ error }: { error: unknown }) {
  return error == null ? null : (
    <p role="alert" className="m-0 text-sm">
      {textOf(error)}
    </p>
  );
}

/**
 * The name dialog (ADR-0055 Decision 5): a small form shown in place, never a modal that traps the page. The field takes
 * focus, Enter saves, Escape cancels. `onSave` throws to say why it could not; the form stays open with the reason.
 */
export function NameForm({
  label,
  initial,
  save,
  note,
  onSave,
  onClose,
}: {
  label: string;
  initial: string;
  save: string;
  /** A line under the field about what saving will do. */
  note?: string | null | undefined;
  onSave: (name: string) => Promise<unknown>;
  onClose: (saved: boolean) => void;
}) {
  const [name, setName] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const { busy, error, run } = useRun();
  useEffect(() => field.current?.focus(), []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    const bad = nameProblem(trimmed);
    setProblem(bad);
    if (bad === null && (await run(() => onSave(trimmed)))) onClose(true);
  };
  return (
    <form
      aria-label={label}
      onSubmit={(e) => void submit(e)}
      onKeyDown={(e) => e.key === "Escape" && onClose(false)}
      className="grid gap-2 rounded-card border border-line bg-surface-2 p-3"
    >
      <label className="grid gap-1 text-sm">
        Name
        <input
          ref={field}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={64}
          aria-invalid={problem !== null}
          aria-describedby={problem === null ? undefined : "designation-name-problem"}
        />
      </label>
      {problem !== null && (
        <p id="designation-name-problem" role="alert" className="m-0 text-sm">
          {problem}
        </p>
      )}
      {note != null && <p className="m-0 text-sm text-muted">{note}</p>}
      <ErrorLine error={error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="min-h-touch">
          {save}
        </button>
        <button type="button" disabled={busy} onClick={() => onClose(false)} className="min-h-touch">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** "Designated": this factory is the player's own, not derived. A word and a border, not colour alone. */
export function DesignatedMarker() {
  return (
    <span className="inline-block justify-self-start rounded-control border border-info-edge bg-info-soft px-2 text-sm text-info-on-soft">
      Designated
    </span>
  );
}

/**
 * A designated factory's status from the designation read (ADR-0055 Decision 5): what an older designation claimed, what
 * is no longer found (with Clean up) and an unmatched one (listed, never deleted). Owners and admins also get Rename and Remove.
 */
export function DesignatedControls({ model }: { model: FactoryModel }) {
  const { factory } = model;
  const { canWrite, designations, missing, writes } = useDesignations();
  const designation = designations?.designations.find((d) => d.id === factory.designationId);
  const match = designations?.matches.find((m) => m.designationId === factory.designationId);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const rename = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // The confirm replaces the Remove button: focus its Cancel on open and the Remove button again on close.
  const openConfirm = () => {
    setConfirming(true);
    queueMicrotask(() => cancel.current?.focus());
  };
  const closeConfirm = () => {
    setConfirming(false);
    queueMicrotask(() => trigger.current?.focus());
  };
  const { busy, error, run } = useRun();
  const changes = useDesignationChanges();
  if (designation === undefined || match === undefined) return <DesignatedMarker />;
  // ADR-0055 Decision 12: with revisions (a backend that has replace) Remove is Dissolve, with an undo offer after it.
  const dissolving = designation.revision !== undefined && changes !== null ? dissolveRequest(designation) : null;
  const dissolve =
    dissolving === null || !dissolving.ok || changes === null
      ? null
      : () => changes.apply(dissolving, { message: `Dissolved ${designation.name}. Its machines are suggestions again.`, undoLabel: "Undo" });
  const verb = dissolve === null ? "Remove" : "Dissolve";

  const gone = missing?.get(designation.id);
  const allGone = match.matched === 0 && match.missing > 0;
  // Offered only when this page and the backend agree on which members are gone.
  const canClean = !allGone && match.missing > 0 && gone !== undefined && gone.length === match.missing;
  return (
    <div className="grid content-start gap-2">
      <DesignatedMarker />
      {match.claimedBy !== undefined && <p className="m-0 break-words text-sm">{claimedText(match.claimedBy.count, match.claimedBy.name)}</p>}
      {allGone ? (
        <p className="m-0 text-sm">{ALL_MISSING_TEXT}</p>
      ) : (
        match.missing > 0 && <p className="m-0 text-sm">{missingText(match.missing)}</p>
      )}
      {canWrite && writes !== null && (
        <>
          {renaming ? (
            <NameForm
              label={`Rename ${factory.name}`}
              initial={designation.name}
              save="Save name"
              onSave={(name) => writes.update.mutateAsync({ id: designation.id, body: { name } })}
              onClose={() => {
                setRenaming(false);
                queueMicrotask(() => rename.current?.focus());
              }}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button ref={rename} type="button" disabled={busy} onClick={() => setRenaming(true)} aria-label={`Rename ${factory.name}`} className="min-h-touch">
                Rename
              </button>
              {canClean && (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Clean up ${factory.name}`}
                  className="min-h-touch"
                  onClick={() => {
                    const lost = new Set(gone);
                    void run(() => writes.update.mutateAsync({ id: designation.id, body: { members: designation.members.filter((m) => !lost.has(m)) } }));
                  }}
                >
                  Clean up
                </button>
              )}
              {confirming ? (
                <span role="group" aria-label={`Confirm ${verb.toLowerCase()} ${factory.name}`} className="flex flex-wrap items-center gap-2 text-sm">
                  {dissolve === null ? "Remove this designation?" : "Dissolve this factory? Its machines go back to suggestions."}
                  <button
                    type="button"
                    disabled={busy}
                    className={`${DANGER_BUTTON} min-h-touch`}
                    onClick={() =>
                      void run(() => (dissolve === null ? writes.remove.mutateAsync(designation.id) : dissolve())).then((done) => {
                        // A dissolve hands the focus to the undo offer; the confirm goes with the factory.
                        if (done && dissolve === null) closeConfirm();
                        else if (done) setConfirming(false);
                      })
                    }
                  >
                    {verb}
                  </button>
                  <button ref={cancel} type="button" disabled={busy} onClick={() => closeConfirm()} className="min-h-touch">
                    Cancel
                  </button>
                </span>
              ) : (
                <button ref={trigger} type="button" disabled={busy} onClick={openConfirm} aria-label={`${verb} ${factory.name}`} className={`${DANGER_BUTTON_QUIET} min-h-touch`}>
                  {verb}
                </button>
              )}
            </div>
          )}
          <ErrorLine error={error} />
        </>
      )}
    </div>
  );
}

/** "Designate selected" over the groups ticked in the table (the keyboard and narrow-screen form of the canvas lasso). */
export function DesignateBar({ nodes, onDone }: { nodes: readonly PlannerNode[]; onDone: () => void }) {
  const { places, writes } = useDesignations();
  const [naming, setNaming] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  if (writes === null) return null;
  const machines = nodes.reduce((sum, n) => sum + n.count, 0);
  return naming ? (
    <NameForm
      label="Name the designated factory"
      initial=""
      save="Designate"
      onSave={(name) => {
        const made = membersOf(nodes, places ?? new Map());
        if (!made.ok) throw new PlanProblem(made.reason);
        return writes.create.mutateAsync({ name, mode: "core", members: made.members });
      }}
      onClose={(saved) => {
        setNaming(false);
        if (saved) onDone();
        else queueMicrotask(() => opener.current?.focus());
      }}
    />
  ) : (
    <div className="flex flex-wrap items-center gap-3">
      <button ref={opener} type="button" disabled={nodes.length === 0} onClick={() => setNaming(true)} className="min-h-touch">
        Designate selected
      </button>
      <span role="status" className="text-sm text-muted">
        {nodes.length === 0
          ? "Tick groups to designate them as one factory."
          : `${nodes.length} ${nodes.length === 1 ? "group" : "groups"}, ${machines} ${machines === 1 ? "machine" : "machines"} selected`}
      </span>
    </div>
  );
}
