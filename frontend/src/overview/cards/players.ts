import type { Status } from "@satisfactory-dash/shared";

/** More slots than this show as "+N" (a mod or server config can raise the limit). */
export const MAX_FIGURES = 8;

/** The one sentence the Players card means; the figures only illustrate it. */
export function playersText(status: Status): string {
  return `${status.connectedPlayers} of ${status.playerLimit} ${status.playerLimit === 1 ? "player" : "players"} connected`;
}
