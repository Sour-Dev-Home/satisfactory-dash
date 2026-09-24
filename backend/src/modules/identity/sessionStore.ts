/**
 * ADR-0025 decision 4: how sessions are created, found and revoked. The routes and the guard
 * depend only on this interface, so the database-backed store (deploy A onward) and the original
 * stateless one (no DATABASE_URL, until PR 9 removes it) are interchangeable and the HTTP
 * contract does not change.
 */

/** A verified account, as the routes and other modules see it (`res.locals.user`). */
export interface SessionUser {
  /** The account id. A uuid in database mode; the fixed operator key in stateless mode. */
  id: string;
  /** Display name (the operator's username for password login). */
  name: string;
  email?: string;
  /** "password" and/or "google" (database mode only). */
  authMethods?: string[];
}

/** Who just proved their identity (the authenticator's answer). */
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
   *  does not survive a re-login. An unknown, malformed or already-ended value is ignored. (The
   *  stateless store keeps no such state and ignores it.) */
  create(principal: Principal, replacing?: string): Promise<CreatedSession>;
  /** The signed-in user for this cookie value, or null (missing, malformed, unknown, revoked,
   *  expired, or a disabled account). Throws ServiceUnavailableError when the store's backing
   *  database is down: an outage must never look like "signed out". */
  resolve(cookieValue: string | undefined): Promise<SessionUser | null>;
  /** Ends this one session (logout). Never throws for an unknown or already-ended session. */
  revoke(cookieValue: string | undefined): Promise<void>;
  /** "Sign out everywhere": ends every session of the account. Returns how many were ended
   *  (the stateless store can only end the current one and returns 0). */
  revokeAllFor(user: SessionUser): Promise<number>;
  /** True when a cookie value has the shape of THIS store's session ids (used to clear an old
   *  or foreign cookie without asking the database). */
  recognizes(cookieValue: string): boolean;
}
