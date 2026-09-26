import type { Status } from "@satisfactory-dash/shared";

/** A figure per slot up to the game's default 12; a mod can raise the limit, and more show as "+N". */
export const MAX_FIGURES = 12;
/** Online names listed on the card, one per figure; more than this reads "and N more" (ADR-0029: a short list). */
export const MAX_NAMES = MAX_FIGURES;

/** The one sentence the Players card means; the figures only illustrate it. */
export function playersText(status: Status): string {
  return `${status.connectedPlayers} of ${status.playerLimit} ${status.playerLimit === 1 ? "player" : "players"} connected`;
}
