import type { ReactNode } from "react";

/**
 * A <select> styled like the inputs (index.css styles `input` and `button` for 44 px targets, but has no
 * `select` rule yet): the same height, padding, border and background, so it's a full-size target and its
 * error border shows. Remove once index.css styles `select` itself.
 */
const SELECT = "min-h-[44px] rounded-lg border border-line bg-canvas px-3 text-fg-strong";

/** The control's side of FormField: its id, invalid state and description (the error, else the hint). */
export function fieldAttrs(id: string, hint: ReactNode | undefined, error: string | undefined, control: "input" | "select" = "input") {
  // The error replaces the hint (FormField), so it's one or the other.
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : "";
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy || undefined,
    className: `${control === "select" ? `${SELECT} ` : ""}aria-[invalid=true]:border-bad`,
  } as const;
}
