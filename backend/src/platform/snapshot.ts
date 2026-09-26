/**
 * ADR-0004's snapshot envelope. Request-through today (ADR-0010): the data was just
 * read from the game server, so observedAt is now and it is never stale. A future
 * poller serves its last snapshot here instead, without a contract change.
 *
 * ADR-0031 PR 5a: a server reached through an agent serves the agent's last snapshot, so its data was NOT just read.
 * Its services wrap what they return with `observed(...)`, and `snapshot` then uses that reading's own time and
 * staleness instead of "now, fresh". The routes are unchanged: they still call `snapshot(serverId, data)`.
 */
export interface Observation {
  /** When the reading was taken (ISO time). */
  observedAt: string;
  /** true = older than the reading's own cadence allows: last known data. */
  stale: boolean;
}

const OBSERVATION = Symbol("observation");

/** A shallow copy of `data` that remembers when it was read. The copy is what a route sends; the original (which may
 *  be shared, in a store) is never touched. The mark is a non-enumerable symbol, so it never reaches a response body. */
export function observed<T extends object>(data: T, observation: Observation): T {
  const copy: T = Array.isArray(data) ? ([...data] as unknown as T) : { ...data };
  Object.defineProperty(copy, OBSERVATION, { value: observation, enumerable: false });
  return copy;
}

export function snapshot<T>(serverId: string, data: T): { serverId: string; observedAt: string; stale: boolean; data: T } {
  const mark = typeof data === "object" && data !== null ? (data as { [OBSERVATION]?: Observation })[OBSERVATION] : undefined;
  return { serverId, observedAt: mark?.observedAt ?? new Date().toISOString(), stale: mark?.stale ?? false, data };
}
