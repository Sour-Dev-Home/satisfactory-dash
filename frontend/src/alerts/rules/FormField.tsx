import type { ReactNode } from "react";

/**
 * One labelled field, as the server form lays them out: the hint and the error sit outside the
 * <label>, so the field's name is only its label, and both are tied to it with aria-describedby.
 */
export function FormField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  /** The control; give it `{...fieldAttrs(id, hint, error)}` (fieldAttrs.ts). */
  children: ReactNode;
}) {
  return (
    <div className="grid content-start gap-1.5 text-sm">
      <label htmlFor={id}>{label}</label>
      {children}
      {/* The error replaces the hint: it says the same bounds, and nobody needs to hear them twice. */}
      {hint && !error && (
        <span id={`${id}-hint`} className="text-muted">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} className="font-medium text-bad">
          {error}
        </span>
      )}
    </div>
  );
}
