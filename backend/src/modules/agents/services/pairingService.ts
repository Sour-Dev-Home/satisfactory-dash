import { randomBytes } from "node:crypto";
import {
  DisplayNameSchema,
  PAIRING_EXPIRES_IN_SECONDS,
  PAIRING_POLL_INTERVAL_SECONDS,
  PAIRING_SLOW_DOWN_SECONDS,
} from "@satisfactory-dash/shared";
import type { Cadence, PairingApproveRequest, PairingLookupResponse, PairingStartRequest, PairingStartResponse } from "@satisfactory-dash/shared";
import type { Logger } from "pino";
import { recordAuditEvent } from "../../../platform/audit/auditRepository.js";
import { isDatabaseUnavailable } from "../../../platform/db/errors.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { withTransaction } from "../../../platform/db/transaction.js";
import { ApiFailure, ForbiddenError, ServiceUnavailableError } from "../../../platform/errorResponse.js";
import type { MetricsRecorder } from "../../../platform/metrics/index.js";
import { lockServerForPairing } from "../../servers/index.js";
import { PAIRING_POLL_GRACE_SECONDS } from "../config.js";
import { sha256 } from "../repositories/agentRepository.js";
import {
  approvePairing,
  consumePairing,
  findOpenPairing,
  insertPairing,
  lockPairingBySecret,
  lockServerRow,
  peekPairingServer,
  touchPairingPoll,
} from "../repositories/pairingRepository.js";
import { generateAgentSecret, generateEnrollmentCode } from "./enrollmentCode.js";
import { installAgentCredential } from "./enrollmentService.js";

/**
 * ADR-0051 section 1 + ADR-0057 D6: device-code pairing (RFC 8628 shape). The agent starts a pairing and gets a secret (kept
 * by the agent, stored here only as a hash) and a 60-bit code for the owner; the owner approves the code in the dashboard,
 * for a NEW server (the self-serve create, with its caps, in the same transaction as the approval) or one they own; the
 * agent's next poll mints its credential with the SAME step enrolment uses and spends the pairing (single use).
 *
 * Nothing here says why a code or secret is not good: an unknown, approved, spent or expired code is one `not_found`
 * failure (and an `existing` target the caller does not own, or that is gone, is the same one), and the poll reads an
 * unknown, spent or expired secret as `expired`. No audit event or log line carries a code, a secret or a name.
 */
export type PairingPollOutcome =
  | { status: "pending" | "expired" | "slow_down" }
  | { status: "approved"; agentSecret: string; serverId: string; cadence: Cadence };

export interface PairingService {
  start(input: PairingStartRequest): Promise<PairingStartResponse>;
  poll(pairingSecret: string): Promise<PairingPollOutcome>;
  lookup(userCode: string): Promise<PairingLookupResponse>;
  approve(actorUserId: string, input: PairingApproveRequest): Promise<{ serverId: string }>;
}

export interface PairingServiceDeps {
  db: Queryable & Parameters<typeof withTransaction>[0];
  cadence: () => Cadence;
  /** Replaces the server's running entry with an agent-backed one (as after an enrolment). Idempotent. */
  attachAgentRuntime: (publicId: string) => Promise<void>;
  /** The self-serve create (servers module, with C1 to C5), given the approval to run in its transaction. Resolves to the new
   *  server's public id. */
  createServer: (
    actorUserId: string,
    displayName: string,
    inTransaction: (client: Queryable, server: { id: string; publicId: string }) => Promise<void>,
  ) => Promise<{ id: string }>;
  /** False when SELF_SERVE_ENABLED is off: approving a NEW server is then refused (403), as the create route does. */
  selfServeEnabled: () => boolean;
  /** True for the operator's account: it may also re-pair a server this backend reads directly ('local'). */
  isOperator: (userId: string) => boolean;
  metrics: MetricsRecorder;
  logger: Logger;
}

/** The ONE refusal for a code that is not good, a server the caller may not re-pair, and a lost approval race. */
export const pairingNotFound = (): ApiFailure => new ApiFailure("not_found", "That pairing code is not valid or has expired.");

const DEFAULT_SERVER_NAME = "My server";
const MAX_CODE_DRAWS = 5;
const MAX_POLL_INTERVAL_SECONDS = 60;

/** The agent's name for itself as the new server's display name: cut to the name rule's 64 characters and checked against it
 *  (the agent's text is untrusted), else a plain default. */
export function displayNameFor(serverName: string | null): string {
  if (serverName === null) return DEFAULT_SERVER_NAME;
  const parsed = DisplayNameSchema.safeParse(Array.from(serverName.trim()).slice(0, 64).join("").trim());
  return parsed.success ? parsed.data : DEFAULT_SERVER_NAME;
}

export function createPairingService(deps: PairingServiceDeps): PairingService {
  const orUnavailable = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (err) {
      if (isDatabaseUnavailable(err)) throw Object.assign(new ServiceUnavailableError(), { cause: err });
      throw err;
    }
  };

  return {
    start: (input) =>
      orUnavailable(async () => {
        for (let draw = 0; draw < MAX_CODE_DRAWS; draw++) {
          const pairingSecret = randomBytes(16).toString("base64url"); // 128 bits, 22 characters
          const userCode = generateEnrollmentCode();
          const stored = await insertPairing(deps.db, {
            secretHash: sha256(pairingSecret),
            userCode,
            serverName: input.serverName,
            agentVersion: input.agentVersion,
            expiresInSeconds: PAIRING_EXPIRES_IN_SECONDS,
          });
          if (stored) {
            deps.metrics.counter("satis.pairing.events", { event: "started" });
            return { pairingSecret, userCode, expiresIn: PAIRING_EXPIRES_IN_SECONDS, interval: PAIRING_POLL_INTERVAL_SECONDS };
          }
        }
        throw new Error("could not draw an unused pairing code");
      }),

    poll: (pairingSecret) =>
      orUnavailable(async () => {
        const secretHash = sha256(pairingSecret);
        const agentSecret = generateAgentSecret();
        type Outcome = PairingPollOutcome | { status: "minted"; serverId: string } | { status: "retry" };
        let outcome: Outcome = { status: "retry" };
        // An approval may commit between the unlocked peek and the pairing lock; then the server row was not locked first, so
        // the transaction starts over (at most a few times: an approval happens once).
        for (let attempt = 0; attempt < 3 && outcome.status === "retry"; attempt++) {
          outcome = await pollOnce();
        }
        if (outcome.status === "retry") return { status: "pending" };
        return finish(outcome);

        async function pollOnce(): Promise<Outcome> {
        return withTransaction(deps.db, async (client): Promise<Outcome> => {
          // Lock order: the server row, then the pairing row, as the approval takes them (so a poll and an approval cannot deadlock).
          const approvedFor = await peekPairingServer(client, secretHash);
          if (approvedFor === undefined) return { status: "expired" };
          // A server removed since the approval leaves nothing to mint for: the pairing just expires on its own.
          if (approvedFor !== null && !(await lockServerRow(client, approvedFor))) return { status: "expired" };
          const pairing = await lockPairingBySecret(client, secretHash);
          if (pairing === undefined || pairing.consumed || !pairing.open) return { status: "expired" };
          if (pairing.serverUuid !== approvedFor) return { status: "retry" };
          // RFC 8628 section 3.5: a poll sooner than the interval is told to slow down, and the interval grows for the rest of
          // the pairing (the agent adds the same to its own). Every poll is recorded, so hammering never earns a free answer.
          const tooSoon = pairing.secondsSincePoll !== null && pairing.secondsSincePoll < pairing.pollIntervalSeconds - PAIRING_POLL_GRACE_SECONDS;
          const interval = tooSoon ? Math.min(MAX_POLL_INTERVAL_SECONDS, pairing.pollIntervalSeconds + PAIRING_SLOW_DOWN_SECONDS) : pairing.pollIntervalSeconds;
          await touchPairingPoll(client, pairing.id, interval);
          if (tooSoon) return { status: "slow_down" };
          if (!pairing.approved || pairing.serverUuid === null) return { status: "pending" };
          // Approved: spend the pairing and mint, together.
          if (!(await consumePairing(client, pairing.id))) return { status: "expired" };
          const publicId = await installAgentCredential(client, {
            serverUuid: pairing.serverUuid,
            agentSecret,
            agentVersion: pairing.agentVersion,
            detail: { via: "pairing" },
          });
          // Cannot happen under the server lock taken above; if it does, nothing of this transaction may stay (the credential row).
          if (publicId === undefined) throw new Error("the paired server disappeared under its lock");
          return { status: "minted", serverId: publicId };
        });
        }

        async function finish(outcome: Exclude<Outcome, { status: "retry" }>): Promise<PairingPollOutcome> {
        if (outcome.status !== "minted") return outcome;
        try {
          await deps.attachAgentRuntime(outcome.serverId);
        } catch (err) {
          // The credential is valid and the agent must get it: the first snapshot attaches the runtime again.
          deps.logger.error({ serverId: outcome.serverId, error: err instanceof Error ? err.name : "unknown" }, "could not attach the agent's server after pairing");
        }
        return { status: "approved", agentSecret, serverId: outcome.serverId, cadence: deps.cadence() };
        }
      }),

    lookup: (userCode) =>
      orUnavailable(async () => {
        const open = await findOpenPairing(deps.db, userCode);
        if (open === undefined) throw pairingNotFound();
        return { serverName: open.serverName, agentVersion: open.agentVersion, requestedAt: open.createdAt.toISOString() };
      }),

    approve: (actorUserId, { userCode, target }) =>
      orUnavailable(async () => {
        if (target.kind === "new") {
          const open = await findOpenPairing(deps.db, userCode);
          if (open === undefined) throw pairingNotFound();
          if (!deps.selfServeEnabled()) throw new ForbiddenError("Adding your own server is not available yet.");
          // One transaction: the server (under the caps), its owner and the approval, so a refused cap or a lost race leaves no
          // server behind and a second approval of the same code creates none.
          const server = await deps.createServer(actorUserId, displayNameFor(open.serverName), async (client, created) => {
            if (!(await approvePairing(client, { userCode, userId: actorUserId, serverUuid: created.id }))) throw pairingNotFound();
            await recordAuditEvent(client, { action: "agent.pairing_approved", actorUserId, serverId: created.id, detail: { target: "new" } });
          });
          deps.metrics.counter("satis.pairing.events", { event: "approved" });
          return { serverId: server.id };
        }
        // An existing server: its OWNER only; an unknown, removed or someone else's server is the same refusal as a bad code,
        // and the code is always looked at too, so the work done does not tell which of the two was wrong.
        const approved = await withTransaction(deps.db, async (client) => {
          const server = await lockServerForPairing(client, target.serverId, actorUserId);
          const open = await findOpenPairing(client, userCode);
          const allowed = server !== undefined && server.isOwner && (server.connectionKind === "agent" || deps.isOperator(actorUserId));
          if (!allowed || open === undefined) return false;
          if (!(await approvePairing(client, { userCode, userId: actorUserId, serverUuid: server.serverId }))) return false;
          await recordAuditEvent(client, { action: "agent.pairing_approved", actorUserId, serverId: server.serverId, detail: { target: "existing" } });
          return true;
        });
        if (!approved) throw pairingNotFound();
        deps.metrics.counter("satis.pairing.events", { event: "approved" });
        return { serverId: target.serverId };
      }),
  };
}
