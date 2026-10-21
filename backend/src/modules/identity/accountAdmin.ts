import { recordAuditEvent } from "../../platform/audit/auditRepository.js";
import { timedQuery } from "../../platform/db/timedQuery.js";
import { withTransaction } from "../../platform/db/transaction.js";
import type { Db } from "./dbSessionStore.js";
import { setUserStatus } from "./repositories/userRepository.js";
import { revokeAllSessionsForUser } from "./repositories/sessionRepository.js";

/**
 * The operator's abuse response for an account (#516, ADR-0045, ADR-0046), run locally as
 * `npm run admin -- disable-user <user-id>` / `enable-user <user-id>`; shell access to the PC is the
 * trust boundary. Disabling sets the status that sign-in already refuses, ends every session of the
 * account and revokes the agent credentials of the live servers it OWNS, all in the SAME transaction, so it takes
 * effect at once (the servers and their data are kept; after re-enabling, the owner enrols an agent again).
 * Each writes an audit row (no actor: null means the CLI; the user id and counts only, never an email or a name).
 */
export type AccountAdminResult = { found: false } | { found: true; sessionsRevoked: number; agentsRevoked: number };

// The servers the account owns and that are still live. Constants, no interpolation.
const REVOKE_OWNED_AGENTS = `
  UPDATE agents.agent_credentials c
  SET revoked_at = now()
  WHERE c.revoked_at IS NULL
    AND c.server_id IN (
      SELECT m.server_id FROM servers.server_members m
      JOIN servers.servers s ON s.id = m.server_id
      WHERE m.user_id = $1 AND m.role = 'owner' AND s.deleted_at IS NULL)
  RETURNING c.server_id`;

// An unspent enrolment code would let someone enrol a new agent on the disabled owner's server.
const DROP_OWNED_CODES = `
  DELETE FROM agents.enrollment_codes e
  WHERE e.consumed_at IS NULL
    AND e.server_id IN (
      SELECT m.server_id FROM servers.server_members m
      JOIN servers.servers s ON s.id = m.server_id
      WHERE m.user_id = $1 AND m.role = 'owner' AND s.deleted_at IS NULL)`;

export async function disableUserAdmin(db: Db, userId: string): Promise<AccountAdminResult> {
  return withTransaction(db, async (client) => {
    if (!(await setUserStatus(client, userId, "disabled"))) return { found: false };
    const sessionsRevoked = await revokeAllSessionsForUser(client, userId);
    const agentsRevoked = (await timedQuery(client, "identity.disableUser.revokeAgents", REVOKE_OWNED_AGENTS, [userId])).rows.length;
    await timedQuery(client, "identity.disableUser.dropCodes", DROP_OWNED_CODES, [userId]);
    await recordAuditEvent(client, { action: "user.disabled", detail: { userId, sessionsRevoked, agentsRevoked } });
    return { found: true, sessionsRevoked, agentsRevoked };
  });
}

export async function enableUserAdmin(db: Db, userId: string): Promise<AccountAdminResult> {
  return withTransaction(db, async (client) => {
    if (!(await setUserStatus(client, userId, "active"))) return { found: false };
    // A sign-in that raced the disable (it read the account as active, then inserted its session after the disable
    // committed) leaves a live row that the status check only hides; re-enabling would revive it. Enabling therefore
    // revokes whatever is still unrevoked, so "not the old sessions" holds without a race.
    const sessionsRevoked = await revokeAllSessionsForUser(client, userId);
    await recordAuditEvent(client, { action: "user.enabled", detail: { userId, sessionsRevoked } });
    return { found: true, sessionsRevoked, agentsRevoked: 0 };
  });
}
