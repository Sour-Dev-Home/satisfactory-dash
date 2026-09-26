import type { Logger } from "pino";
import type { Cadence, EnrollResponse } from "@satisfactory-dash/shared";
import { ApiFailure, ServiceUnavailableError } from "../../../platform/errorResponse.js";
import { isDatabaseUnavailable } from "../../../platform/db/errors.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { withTransaction } from "../../../platform/db/transaction.js";
import { recordAuditEvent } from "../../../platform/audit/auditRepository.js";
import { switchToAgentConnection } from "../../servers/index.js";
import { consumeCode, findOpenCodeServer, lockServer, sha256, upsertCredential } from "../repositories/agentRepository.js";
import { generateAgentSecret } from "./enrollmentCode.js";

/**
 * ADR-0031 PR 5a, POST /agent/v1/enroll: the agent trades a one-time code for its credential. The code is spent by ONE
 * guarded UPDATE, so two agents (or a replay, or a race) cannot both win; an unknown, used, expired or removed-server
 * code is the same `enrollment_code_invalid`, so the answer is no oracle. In the same transaction the server becomes an
 * 'agent' server and its stored game-server tokens are deleted (this backend no longer reaches the game itself), and an
 * audit event is written (ids only). Only after the commit does the process swap its running entry for the server, so a
 * failed enrolment never stops a working local server's pollers.
 */
export interface EnrollmentService {
  enroll(code: string, agentVersion: string): Promise<EnrollResponse>;
}

export interface EnrollmentServiceDeps {
  db: Queryable & Parameters<typeof withTransaction>[0];
  cadence: () => Cadence;
  /** Called after the commit with the server's public id: replaces the server's running entry (its pollers stop) with an
   *  agent-backed one. Idempotent. */
  attachAgentRuntime: (publicId: string) => Promise<void>;
  logger: Logger;
}

const codeInvalid = (): ApiFailure => new ApiFailure("enrollment_code_invalid", "That enrollment code is not valid. Create a new one in the dashboard.");

export function createEnrollmentService(deps: EnrollmentServiceDeps): EnrollmentService {
  return {
    async enroll(code, agentVersion) {
      const agentSecret = generateAgentSecret();
      let publicId: string;
      try {
        publicId = await withTransaction(deps.db, async (client) => {
          // Lock order: the server row first, then the code (as code creation and revoke do), so they cannot deadlock.
          const codeHash = sha256(code);
          const owner = await findOpenCodeServer(client, codeHash);
          if (owner === undefined || (await lockServer(client, owner)) === undefined) throw codeInvalid();
          const serverUuid = await consumeCode(client, codeHash);
          if (serverUuid === undefined) throw codeInvalid();
          await upsertCredential(client, { serverUuid, secretHash: sha256(agentSecret), agentVersion });
          const switched = await switchToAgentConnection(client, serverUuid);
          if (switched === undefined) throw codeInvalid(); // the server was removed between the two statements: roll the code back too
          await recordAuditEvent(client, { action: "agent.enrolled", serverId: serverUuid, detail: {} });
          return switched;
        });
      } catch (err) {
        if (isDatabaseUnavailable(err)) throw Object.assign(new ServiceUnavailableError(), { cause: err });
        throw err;
      }
      try {
        await deps.attachAgentRuntime(publicId);
      } catch (err) {
        // The credential is valid and the agent must get it: the first snapshot attaches the runtime again (see the ingest route).
        deps.logger.error({ serverId: publicId, error: err instanceof Error ? err.name : "unknown" }, "could not attach the agent's server after enrolment");
      }
      return { agentSecret, serverId: publicId, cadence: deps.cadence() };
    },
  };
}
