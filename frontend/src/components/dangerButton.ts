/**
 * Destructive actions (#275): delete, remove, revoke. Two strengths from the status tokens, both
 * WCAG AA on the panel surfaces. The confirm step around them stays as it is.
 *
 * DANGER_BUTTON is the button that destroys (a confirm's "Delete", "Remove server"): a filled
 * `bad-solid` with white text (6.2:1). DANGER_BUTTON_QUIET is the button that opens that confirm,
 * sitting among ordinary ones: `bad-on-soft` text (6.8:1 or more). Both carry a `bad` border, at
 * least 4.6:1 against the panel, since the fill alone (2.5:1) is too faint to mark the control.
 * Focus keeps the site-wide ring.
 */
export const DANGER_BUTTON = "border-bad bg-bad-solid text-white hover:not-disabled:border-bad-on-soft";

export const DANGER_BUTTON_QUIET = "border-bad text-bad-on-soft hover:not-disabled:bg-bad-soft";
