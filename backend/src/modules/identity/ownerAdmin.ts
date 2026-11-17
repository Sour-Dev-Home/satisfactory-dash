import { recordAuditEvent } from "../../platform/audit/auditRepository.js";
import { timedQuery } from "../../platform/db/timedQuery.js";
import { withTransaction } from "../../platform/db/transaction.js";
import { OPERATOR_SUBJECT } from "./authenticator.js";
import type { Db } from "./dbSessionStore.js";
import { revokeAllSessionsForUser } from "./repositories/sessionRepository.js";
import { findUserByIdentity, setUserEmail, type UserStatus } from "./repositories/userRepository.js";

/**
 * The break-glass for the operator's own sign-in (ADR-0025 Decision 5, gate B 2026-11-17), run as
 * `npm run admin -- grant-owner --email <address>`. With password login gone, Google is the only way in, so losing
 * the linked Google account must not lock the operator out. In one transaction it:
 *   - unlinks every Google identity from the operator (the `local` / `operator` identity stays: it is the anchor),
 *   - stores `email` on the operator, so the next Google sign-in with that VERIFIED address links to the operator
 *     (`googleSignIn.ts` resolveUser), exactly like the first link through BOOTSTRAP_OWNER_EMAIL,
 *   - ends every session of the operator, so a session of the old Google account stops working at once,
 *   - writes an audit row (ids and counts, never the address).
 * The Google account named must not already have an account of its own: its own account wins on sign-in. Delete
 * that one first (`delete-user`). Running the CLI is the trust boundary (shell on the PC, or the AWS ops task).
 */
export type GrantOwnerResult =
  | { found: false }
  | { found: true; userId: string; googleUnlinked: number; sessionsRevoked: number; status: UserStatus };

// A constant, no interpolation.
const UNLINK_GOOGLE = `
  DELETE FROM identity.auth_identities
  WHERE user_id = $1 AND provider = 'google'
  RETURNING user_id`;

/** Loose on purpose (Google decides what a valid address is); it only stops an obvious typo or an argument mix-up. */
export const GRANT_OWNER_EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

export async function grantOwnerAdmin(db: Db, email: string): Promise<GrantOwnerResult> {
  // Lowercased here, as the sign-in compares (JS toLowerCase); setUserEmail's lower() then changes nothing.
  const address = email.trim().toLowerCase();
  if (!GRANT_OWNER_EMAIL.test(address) || address.length > 254) {
    throw new Error("not an email address");
  }
  return withTransaction(db, async (client) => {
    const operator = await findUserByIdentity(client, "local", OPERATOR_SUBJECT);
    if (operator === undefined) return { found: false };
    const googleUnlinked = (await timedQuery(client, "identity.grantOwner.unlinkGoogle", UNLINK_GOOGLE, [operator.id])).rows.length;
    await setUserEmail(client, operator.id, address);
    const sessionsRevoked = await revokeAllSessionsForUser(client, operator.id);
    await recordAuditEvent(client, {
      action: "owner.granted",
      detail: { userId: operator.id, googleUnlinked, sessionsRevoked },
    });
    return { found: true, userId: operator.id, googleUnlinked, sessionsRevoked, status: operator.status };
  });
}
