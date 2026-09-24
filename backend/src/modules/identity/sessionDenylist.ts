/** Most revoked sessions remembered at once. A single operator signing out this many
 *  times inside one session lifetime (8 h) is not a real pattern; the cap only bounds
 *  memory if something hammers logout with valid tokens. */
export const MAX_REVOKED_SESSIONS = 10_000;

/**
 * ADR-0019: the logged-out sessions, by session id (`jti`), each remembered until its
 * token would have expired anyway. In memory only, so a restart forgets it (documented;
 * rotating SESSION_SECRET is the emergency revoke-all). Bounded: expired entries are
 * pruned first, and if it is still full the oldest revocation is dropped.
 */
export class SessionDenylist {
  /** jti -> expiry (epoch seconds). A Map iterates in insertion order, oldest first. */
  private readonly revoked = new Map<string, number>();

  constructor(private readonly maxEntries: number = MAX_REVOKED_SESSIONS) {}

  revoke(jti: string, expiresAtSeconds: number, nowMs: number = Date.now()): void {
    const nowSeconds = Math.floor(nowMs / 1000);
    if (expiresAtSeconds <= nowSeconds) {
      return; // Already expired: nothing to remember.
    }
    // Re-inserting moves an existing entry to the newest position.
    this.revoked.delete(jti);
    this.revoked.set(jti, expiresAtSeconds);
    if (this.revoked.size > this.maxEntries) {
      this.prune(nowMs);
    }
    while (this.revoked.size > this.maxEntries) {
      const oldest = this.revoked.keys().next();
      if (oldest.done) {
        break;
      }
      this.revoked.delete(oldest.value);
    }
  }

  isRevoked(jti: string, nowMs: number = Date.now()): boolean {
    const expiresAt = this.revoked.get(jti);
    if (expiresAt === undefined) {
      return false;
    }
    if (expiresAt <= Math.floor(nowMs / 1000)) {
      this.revoked.delete(jti);
      return false;
    }
    return true;
  }

  /** Drops entries whose tokens have expired. */
  prune(nowMs: number = Date.now()): void {
    const nowSeconds = Math.floor(nowMs / 1000);
    for (const [jti, expiresAt] of this.revoked) {
      if (expiresAt <= nowSeconds) {
        this.revoked.delete(jti);
      }
    }
  }

  get size(): number {
    return this.revoked.size;
  }
}
