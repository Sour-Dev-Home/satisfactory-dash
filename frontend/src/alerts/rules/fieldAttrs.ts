import type { ReactNode } from "react";

/** The control's side of FormField: its id, invalid state and description (the error, else the hint). */
export function fieldAttrs(id: string, hint: ReactNode | undefined, error: string | undefined) {
  // The error replaces the hint (FormField), so it's one or the other.
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : "";
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy || undefined,
    className: "aria-[invalid=true]:border-bad",
  } as const;
}
