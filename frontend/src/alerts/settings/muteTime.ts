const MIN = 60_000;

/** The backend refuses a mute more than 7 days ahead (mute_invalid, ADR-0027 decision 4). */
export const MAX_MUTE_MS = 7 * 24 * 60 * MIN;

/** A `datetime-local` value (local time, to the minute) for a moment. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** One hour from now, on a 5-minute mark: a sensible first choice. */
export const defaultMuteUntil = (now: number) => toLocalInput(Math.ceil((now + 60 * MIN) / (5 * MIN)) * 5 * MIN);

/** The chosen local time as the ISO instant to send, or null when it's not in (now, now + 7 days]. */
export function muteUntilIso(localValue: string, now: number): string | null {
  const at = new Date(localValue).getTime();
  if (!Number.isFinite(at) || at <= now || at > now + MAX_MUTE_MS) return null;
  return new Date(at).toISOString();
}
