import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { deleteOpenCodes, revokeCredential } from "../repositories/agentRepository.js";
import { endOpenCommandsOf } from "../repositories/commandRepository.js";

/**
 * ADR-0031 amendment ("Rollback: switch back to local"): everything the AGENT side must let go of when a server stops being
 * reached through an agent. It runs inside the caller's transaction (server management's `switchToLocal`), so the switch and
 * this are one unit:
 *  - the credential is revoked (the agent's next request is a 401 and it halts);
 *  - every unspent enrolment code for the server is dropped, so an old code cannot enrol an agent again and flip the
 *    server back (a fresh code, made deliberately, is the only way back to an agent);
 *  - the waiting commands (`pending` or `sent`) end as `expired`: nothing will fetch them, and a later agent must not run
 *    something asked for in another era.
 * It does not touch history, memberships or the server row: those are the server's, kept across the switch. Returns counts
 * only, for the audit detail (never a secret or a code).
 */
export interface ReleasedAgent {
  credentialRevoked: boolean;
  commandsEnded: number;
}

export async function releaseAgentServer(db: Queryable, serverUuid: string): Promise<ReleasedAgent> {
  await deleteOpenCodes(db, serverUuid);
  const credentialRevoked = await revokeCredential(db, serverUuid);
  const commandsEnded = await endOpenCommandsOf(db, serverUuid);
  return { credentialRevoked, commandsEnded };
}
