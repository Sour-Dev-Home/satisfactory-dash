import type { Status } from "@satisfactory-dash/shared";

/** A figure per slot up to the game's default 12; a mod can raise the limit, and more show as "+N". */
export const MAX_FIGURES = 12;
/** Online names listed on the card, one per figure; more than this reads "and N more" (ADR-0029: a short list). */
export const MAX_NAMES = MAX_FIGURES;

/**
 * A name's initials for its tile: the first letter of its first two words ("Pioneer-Alpha" is "PA"),
 * or its first letter alone. By code point, so an emoji or an accented letter isn't split.
 */
export function initials(name: string): string {
  const words = name.split(/[\s\-_.]+/u).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join("")
    .toLocaleUpperCase();
}

/** The one sentence the Players card means; the tiles only illustrate it. */
export function playersText(status: Status): string {
  return `${status.connectedPlayers} of ${status.playerLimit} ${status.playerLimit === 1 ? "player" : "players"} connected`;
}
