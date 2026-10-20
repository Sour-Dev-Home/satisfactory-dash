/**
 * The header's controls (#444): steel chips, a raised steel surface with a hairline edge, all one
 * height (the touch target) so the row lines up whatever wraps.
 */
export const chip =
  "inline-flex min-h-touch items-center gap-2 rounded-control border border-line bg-surface-2 px-3 font-medium text-fg-strong";

/** The primary action (the landing's demo button, Enter demo): amber, the one accent (ADR-0041). */
export const primaryButton =
  "inline-flex min-h-touch items-center justify-center rounded-control border border-accent bg-accent px-button-x font-semibold text-on-accent no-underline transition-colors";

/** A chip that's a button: its edge brightens on hover, eased by the motion tokens. */
export const chipButton = `${chip} transition-colors hover:border-muted focus-visible:-outline-offset-2`;
