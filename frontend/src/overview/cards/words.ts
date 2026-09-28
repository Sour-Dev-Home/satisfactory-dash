import { ownValue } from "@satisfactory-dash/shared";
import type { Health } from "../health";

/** A health level, or still loading. */
export type Shown = Health | "pending";

/** The state in one word: the Health card's title and each section row's label. */
export const WORD: Record<Shown, string> = {
  ok: "Operational",
  paused: "Paused",
  degraded: "Degraded",
  unavailable: "Unavailable",
  outage: "Outage",
  pending: "Checking…",
};

export const WORD_COLOR: Record<Shown, string> = {
  ok: "text-ok",
  paused: "text-info",
  degraded: "text-warn",
  unavailable: "text-muted",
  outage: "text-bad",
  pending: "text-muted",
};

/** The one-word state; lookups read own keys only (#368), so an unexpected value shows as "Checking…". */
export const wordFor = (shown: Shown) => ownValue(WORD, shown) ?? WORD.pending;
/** The colour for a state, muted for an unexpected value. */
export const wordColor = (shown: Shown) => ownValue(WORD_COLOR, shown) ?? WORD_COLOR.pending;
