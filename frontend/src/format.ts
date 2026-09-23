// Pure display formatters, shared by views (and later by map layers). They round for
// display only; they never change a value's unit or meaning (ADR-0006).

/** An ADR-0004 observedAt (UTC ISO string) in the viewer's local time. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** Whole seconds as "45 s", "12 m", "5 h 3 m" or "1 d 2 h 50 m" (floored). */
export function formatDuration(totalSeconds: number): string {
  const s = Math.floor(totalSeconds);
  if (s < 60) return `${s} s`;
  const minutes = Math.floor(s / 60) % 60;
  const hours = Math.floor(s / 3600) % 24;
  const days = Math.floor(s / 86_400);
  if (days > 0) return `${days} d ${hours} h ${minutes} m`;
  if (hours > 0) return `${hours} h ${minutes} m`;
  return `${minutes} m`;
}

/** Server ticks per second, one decimal. */
export function formatTickRate(ticksPerSecond: number): string {
  return `${ticksPerSecond.toFixed(1)} ticks/s`;
}
