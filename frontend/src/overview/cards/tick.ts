import { ownValue } from "@satisfactory-dash/shared";

/** Below this a slow tick reads as bad rather than a warning; a tick mark on the dial shows where. */
export const SLOW_BELOW = 10;

export type TickTone = "ok" | "warn" | "bad";

/**
 * The tick's colour, for the dial and its word alike (#442): the backend's own verdict decides, so a
 * healthy tick is never drawn red, whatever its rate. A slow one is a warning, and bad below SLOW_BELOW.
 */
export function tickTone({ rate, health }: { rate: number; health: "healthy" | "slow" }): TickTone {
  if (health !== "slow") return "ok";
  return rate < SLOW_BELOW ? "bad" : "warn";
}

const TONE_CLASS: Record<TickTone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad" };

/** The text colour for a tone. */
export const toneClass = (tone: TickTone) => ownValue(TONE_CLASS, tone) ?? TONE_CLASS.ok;
