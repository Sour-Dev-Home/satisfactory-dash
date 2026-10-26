import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PlannerNode } from "@satisfactory-dash/shared";
import { DANGER_BUTTON, DANGER_BUTTON_QUIET } from "../components/dangerButton";
import { useDesignations } from "./DesignationContext";
import { membersOf } from "./designationMatch";
import { ALL_MISSING_TEXT, PlanProblem, claimedText, designationErrorText, missingText, nameProblem } from "./designationText";
import type { FactoryModel } from "./graph/hierarchy";

const textOf = (error: unknown) => (error instanceof PlanProblem ? error.message : designationErrorText(error));

/** Runs one write at a time for its own control and keeps that control's error, so a failure shows beside what failed. */
function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function ErrorLine({ error }: { error: unknown }) {
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
function NameForm({
  label,
  initial,
  save,
  onSave,
  onClose,
}: {
  label: string;
  initial: string;
  save: string;
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
  const { busy, error, run } = useRun();
  if (designation === undefined || match === undefined) return <DesignatedMarker />;

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
                <span role="group" aria-label={`Confirm remove ${factory.name}`} className="flex flex-wrap items-center gap-2 text-sm">
                  Remove this designation?
                  <button
                    type="button"
                    disabled={busy}
                    className={DANGER_BUTTON}
                    onClick={() => void run(() => writes.remove.mutateAsync(designation.id)).then((done) => done && setConfirming(false))}
                  >
                    Remove
                  </button>
                  <button type="button" disabled={busy} onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button type="button" disabled={busy} onClick={() => setConfirming(true)} aria-label={`Remove ${factory.name}`} className={DANGER_BUTTON_QUIET}>
                  Remove
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

/** An automatic factory shown as a suggestion (a dashed frame on its card): "Keep" saves it as a designation. */
export function SuggestionControls({ model }: { model: FactoryModel }) {
  const { factory } = model;
  const { canWrite, places, writes } = useDesignations();
  const [naming, setNaming] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  return (
    <div className="grid content-start gap-2">
      <span className="justify-self-start text-sm text-muted">Suggestion</span>
      {canWrite &&
        writes !== null &&
        (naming ? (
          <NameForm
            label={`Keep ${factory.name}`}
            initial={factory.name.slice(0, 64)}
            save="Keep factory"
            onSave={(name) => {
              const made = membersOf(model.nodes, places ?? new Map());
              if (!made.ok) throw new PlanProblem(made.reason);
              return writes.create.mutateAsync({ name, mode: "core", members: made.members });
            }}
            onClose={(saved) => {
              setNaming(false);
              if (!saved) queueMicrotask(() => keep.current?.focus());
            }}
          />
        ) : (
          <button ref={keep} type="button" onClick={() => setNaming(true)} aria-label={`Keep ${factory.name}`} className="min-h-touch justify-self-start">
            Keep
          </button>
        ))}
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
