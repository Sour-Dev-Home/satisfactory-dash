import { createHash, timingSafeEqual } from "node:crypto";
import { verifyPassword } from "./passwordHash.js";
import type { ParsedPasswordHash } from "./passwordHash.js";
import type { Principal } from "./sessionStore.js";

/** The single operator's FIXED account key. The .env username is only the display name, so
 *  renaming it never forks a second account (ADR-0025). */
export const OPERATOR_SUBJECT = "operator";

/** Who just proved their identity: a stable subject and a display name. */
export type AuthenticatedUser = Principal;

/**
 * ADR-0011: routes depend on this interface, so a later account store or a managed
 * identity provider (e.g. Cognito) swaps in without touching them.
 */
export interface Authenticator {
  /** The user for valid credentials, else null. Never says which part was wrong. */
  verifyCredentials(username: string, password: string): Promise<AuthenticatedUser | null>;
  /** Whether a session subject still names a valid user (e.g. after the operator's
   *  username is changed in config, old sessions stop working). */
  isActiveUser(name: string): boolean;
}

function sameString(a: string, b: string): boolean {
  // Hash both first so the comparison is constant-time regardless of length.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** v1: one operator account from config (DASHBOARD_ADMIN_USER + password hash). */
export class SingleOperatorAuthenticator implements Authenticator {
  constructor(
    private readonly username: string,
    private readonly passwordHash: ParsedPasswordHash,
  ) {}

  async verifyCredentials(username: string, password: string): Promise<AuthenticatedUser | null> {
    // Always run the (slow) password check, even for a wrong username, so the response
    // time doesn't reveal whether the username exists.
    const passwordOk = await verifyPassword(password, this.passwordHash);
    const usernameOk = sameString(username, this.username);
    return passwordOk && usernameOk ? { subject: OPERATOR_SUBJECT, name: this.username } : null;
  }

  isActiveUser(name: string): boolean {
    return sameString(name, this.username);
  }
}
