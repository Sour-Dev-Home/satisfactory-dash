import { recordAuditEvent } from "../../platform/audit/auditRepository.js";
import { withTransaction } from "../../platform/db/transaction.js";
import type { Db } from "./dbSessionStore.js";
import { revokeAllSessions, revokeAllSessionsForUser } from "./repositories/sessionRepository.js";

/**
 * The operator's break-glass session commands (ADR-0025 decision 4), run locally as
 * `npm run admin -- revoke-sessions ...`; shell access to the PC is the trust boundary. They
 * replace rotating SESSION_SECRET. Each writes an audit row in the SAME transaction (no actor: null
 * means the CLI; ids and counts only, never emails or names).
 */
export async function revokeAllSessionsAdmin(db: Db): Promise<number> {
  return withTransaction(db, async (client) => {
    const count = await revokeAllSessions(client);
    await recordAuditEvent(client, { action: "sessions.revoke_all", detail: { count } });
    return count;
  });
}

export async function revokeUserSessionsAdmin(db: Db, userId: string): Promise<number> {
  return withTransaction(db, async (client) => {
    const count = await revokeAllSessionsForUser(client, userId);
    await recordAuditEvent(client, { action: "sessions.revoke_user", detail: { userId, count } });
    return count;
  });
}
