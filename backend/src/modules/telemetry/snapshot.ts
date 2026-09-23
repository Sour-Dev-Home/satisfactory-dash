/**
 * ADR-0004's snapshot envelope. Request-through today (ADR-0010): the data was just
 * read from the game server, so observedAt is now and it is never stale. A future
 * poller serves its last snapshot here instead, without a contract change.
 */
export function snapshot<T>(serverId: string, data: T): { serverId: string; observedAt: string; stale: boolean; data: T } {
  return { serverId, observedAt: new Date().toISOString(), stale: false, data };
}
