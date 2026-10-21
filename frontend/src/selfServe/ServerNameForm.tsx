import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ErrorNotice } from "../components/ErrorNotice";
import { nameProblem } from "./selfServeText";

/**
 * One display-name field with its submit button, for "Add your server" and the owner's rename. The name
 * is checked with the shared schema before anything is sent; a refusal from the backend (`errorText` or,
 * failing that, `error`) shows in a live region under the field. A ref guards a double click, since
 * `busy` lags two clicks in the same tick.
 */
export function ServerNameForm({
  label,
  initialName = "",
  hint,
  submitLabel,
  busyLabel,
  busy,
  error,
  errorText,
  onSubmit,
  onCancel,
  autoFocus,
}: {
  label: string;
  initialName?: string;
  hint?: ReactNode;
  submitLabel: string;
  busyLabel: string;
  busy: boolean;
  error: unknown;
  /** Words for a refusal the caller knows; otherwise `ErrorNotice` shows the error. */
  errorText: string | undefined;
  onSubmit: (displayName: string) => Promise<unknown>;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [name, setName] = useState(initialName);
  const [problem, setProblem] = useState<string | undefined>();
  const sending = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (sending.current || busy) return;
    const found = nameProblem(name);
    setProblem(found);
    if (found) {
      input.current?.focus();
      return;
    }
    sending.current = true;
    // Released when the caller's write settles; the caller shows a failure through `error`.
    void onSubmit(name.trim()).then(
      () => {
        sending.current = false;
      },
      () => {
        sending.current = false;
      },
    );
  };

  const hintId = `${id}-hint`;
  const problemId = `${id}-problem`;
  const describedBy = [hint && hintId, problem && problemId].filter(Boolean).join(" ") || undefined;
  return (
    <form onSubmit={submit} noValidate className="grid gap-2 text-sm">
      <label htmlFor={`${id}-name`}>{label}</label>
      <input
        id={`${id}-name`}
        ref={input}
        className="aria-[invalid=true]:border-bad"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (problem) setProblem(undefined);
        }}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        aria-invalid={problem ? true : undefined}
        aria-describedby={describedBy}
      />
      {hint && (
        <span id={hintId} className="text-muted">
          {hint}
        </span>
      )}
      {problem && (
        <span id={problemId} role="alert" className="font-medium text-bad-on-soft">
          {problem}
        </span>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy}>
          {busy ? busyLabel : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
      {error != null && (errorText ? <p role="alert" className="mb-0 font-medium text-bad-on-soft">{errorText}</p> : <ErrorNotice error={error} />)}
    </form>
  );
}
