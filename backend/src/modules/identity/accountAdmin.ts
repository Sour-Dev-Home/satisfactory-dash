import { recordAuditEvent } from "../../platform/audit/auditRepository.js";
import { withTransaction } from "../../platform/db/transaction.js";
import type { Db } from "./dbSessionStore.js";
import { setUserStatus } from "./repositories/userRepository.js";
import { revokeAllSessionsForUser } from "./repositories/sessionRepository.js";

/**
 * The operator's abuse response for an account (#516, ADR-0045), run locally as
 * `npm run admin -- disable-user <user-id>` / `enable-user <user-id>`; shell access to the PC is the
 * trust boundary. Disabling sets the status that sign-in already refuses and ends every session of the
 * account in the SAME transaction, so it takes effect at once. Each writes an audit row (no actor: null
 * means the CLI; the user id and a count only, never an email or a name).
 */
export type AccountAdminResult = { found: false } | { found: true; sessionsRevoked: number };

export async function disableUserAdmin(db: Db, userId: string): Promise<AccountAdminResult> {
  return withTransaction(db, async (client) => {
    if (!(await setUserStatus(client, userId, "disabled"))) return { found: false };
    const sessionsRevoked = await revokeAllSessionsForUser(client, userId);
    await recordAuditEvent(client, { action: "user.disabled", detail: { userId, sessionsRevoked } });
    return { found: true, sessionsRevoked };
  });
}

export async function enableUserAdmin(db: Db, userId: string): Promise<AccountAdminResult> {
  return withTransaction(db, async (client) => {
    if (!(await setUserStatus(client, userId, "active"))) return { found: false };
    await recordAuditEvent(client, { action: "user.enabled", detail: { userId } });
    return { found: true, sessionsRevoked: 0 };
  });
}
