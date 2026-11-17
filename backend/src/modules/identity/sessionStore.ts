/**
 * ADR-0025 decision 4: how sessions are created, found and revoked. The routes and the guard
 * depend only on this interface: the database-backed store, or (no DATABASE_URL) a store that
 * signs nobody in (noSessionStore.ts, since PR 9 removed password login).
 */

/** How long a session lasts (ADR-0011): 8 hours. */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

/** A verified account, as the routes and other modules see it (`res.locals.user`). */
export interface SessionUser {
  /** The account id (a uuid). */
  id: string;
  /** Display name. */
  name: string;
  email?: string;
  /** How the account signs in: "google" (database mode only). */
  authMethods?: string[];
}

/** Who just proved their identity. */
export interface Principal {
  /** A FIXED key for the account (not the username), so renaming never forks an account. */
  subject: string;
  name: string;
}

export interface CreatedSession {
  /** The value for the session cookie. */
  cookieValue: string;
  maxAgeSeconds: number;
  user: SessionUser;
}

export interface SessionStore {
  /** Starts a session with a fresh id. `replacing` is the session cookie the browser sent with
   *  the login: that session ends in the same step ("rotated on login"), so a copied old cookie
   *  does not survive a re-login. An unknown, malformed or already-ended value is ignored. */
  create(principal: Principal, replacing?: string): Promise<CreatedSession>;
  /** The signed-in user for this cookie value, or null (missing, malformed, unknown, revoked,
   *  expired, or a disabled account). Throws ServiceUnavailableError when the store's backing
   *  database is down: an outage must never look like "signed out". */
  resolve(cookieValue: string | undefined): Promise<SessionUser | null>;
  /** Ends this one session (logout). Never throws for an unknown or already-ended session. */
  revoke(cookieValue: string | undefined): Promise<void>;
  /** "Sign out everywhere": ends every session of the account. Returns how many were ended. */
  revokeAllFor(user: SessionUser): Promise<number>;
  /** True when a cookie value has the shape of THIS store's session ids (used to clear an old
   *  or foreign cookie without asking the database). */
  recognizes(cookieValue: string): boolean;
}
