import type { AgentStatusResponseSchema, EnrollmentCodeResponseSchema, RevokeAgentResponseSchema } from "@satisfactory-dash/shared";
import { AGENT_OFFLINE_DEFAULT_SECONDS } from "@satisfactory-dash/shared";
import type { z } from "zod";
import { ForbiddenError, RateLimitedError, ServerNotFoundError, ServiceUnavailableError } from "../../../platform/errorResponse.js";
import { isDatabaseUnavailable } from "../../../platform/db/errors.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { withTransaction } from "../../../platform/db/transaction.js";
import { recordAuditEvent } from "../../../platform/audit/auditRepository.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import { ENROLLMENT_CODE_TTL_MS } from "../config.js";
import { deleteOpenCodes, getAgentStatus, insertCode, lockServer, revokeCredential, sha256 } from "../repositories/agentRepository.js";
import { generateEnrollmentCode } from "./enrollmentCode.js";

/**
 * ADR-0031 PR 5a: the user-facing side of an agent: an owner or admin creates the one-time enrolment code, any member
 * sees whether an agent is enrolled, and an owner or admin revokes it. The routes call this interface (so the generated
 * authorization tests can stub it). Every method takes the server's PUBLIC id, which the membership check has already
 * passed, and scopes every query by it. Every write runs in one transaction with its audit event: only ids and codes go
 * in the audit detail, never the enrolment code or any secret.
 */
export type EnrollmentCodeBody = z.infer<typeof EnrollmentCodeResponseSchema>;
export type AgentStatusBody = z.infer<typeof AgentStatusResponseSchema>;
export type RevokeAgentBody = z.infer<typeof RevokeAgentResponseSchema>;

export interface AgentsService {
  createEnrollmentCode(serverId: string, actorUserId: string): Promise<EnrollmentCodeBody>;
  getStatus(serverId: string): Promise<AgentStatusBody>;
  revoke(serverId: string, actorUserId: string): Promise<RevokeAgentBody>;
}

export interface AgentsServiceDeps {
  /** The pool: writes use a transaction so each change and its audit event are one unit. */
  db: Queryable & Parameters<typeof withTransaction>[0];
  /** True for the operator account only. Enrolling an agent on a server this backend reaches directly ('local') replaces
   *  its stored game-server tokens, which only the operator manages (ADR-0030), so it needs this. */
  canManage: (userId: string) => boolean;
  /** Codes per user per minute; default 10 (each creation drops the server's previous code). */
  limiter?: UserRateLimiter;
  now?: () => number;
  /** When the backend last received a snapshot from this server's agent (ms), from memory; undefined before the first one.
   *  The composition root reads it from the server's observations. */
  lastHeardAt?: (serverId: string) => number | undefined;
}

/** A database outage is a 503, never a 500 or a "not found". */
async function orUnavailable<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isDatabaseUnavailable(err)) throw Object.assign(new ServiceUnavailableError(), { cause: err });
    throw err;
  }
}

/** Drawing a code that already exists is one in a trillion; this many collisions in a row is a bug, not luck. */
const MAX_CODE_DRAWS = 5;

export function createAgentsService(deps: AgentsServiceDeps): AgentsService {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const limiter = deps.limiter ?? new UserRateLimiter({ max: 10, windowMs: 60_000 });

  return {
    createEnrollmentCode: (serverId, actorUserId) =>
      orUnavailable(async () => {
        const wait = limiter.hit(actorUserId);
        if (wait > 0) throw new RateLimitedError(wait, "Too many enrollment codes. Try again in a moment.");
        return withTransaction(db, async (client) => {
          const server = await lockServer(client, serverId);
          if (server === undefined) throw new ServerNotFoundError();
          if (server.connectionKind === "local" && !deps.canManage(actorUserId)) throw new ForbiddenError();
          await deleteOpenCodes(client, server.id);
          const expiresAt = new Date(now() + ENROLLMENT_CODE_TTL_MS);
          for (let draw = 0; draw < MAX_CODE_DRAWS; draw++) {
            const code = generateEnrollmentCode();
            if (await insertCode(client, { serverUuid: server.id, codeHash: sha256(code), expiresAt, createdBy: actorUserId })) {
              await recordAuditEvent(client, { action: "agent.enrollment_code_created", actorUserId, serverId: server.id, detail: {} });
              return { code, expiresAt: expiresAt.toISOString() };
            }
          }
          throw new Error("could not draw an unused enrollment code");
        });
      }),

    getStatus: (serverId) =>
      orUnavailable(async () => {
        const row = await getAgentStatus(db, serverId);
        if (row === undefined) throw new ServerNotFoundError();
        // `online` only for an enrolled agent, from the backend's OWN memory of the last snapshot (fresher than last_seen_at,
        // which is written at most every 30 s), and false when none arrived in the window or since a restart.
        const heardAt = row.enrolled ? deps.lastHeardAt?.(serverId) : undefined;
        const online = row.enrolled ? heardAt !== undefined && (deps.now ?? Date.now)() - heardAt <= AGENT_OFFLINE_DEFAULT_SECONDS * 1000 : undefined;
        return {
          enrolled: row.enrolled,
          ...(online !== undefined ? { online } : {}),
          lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
          agentVersion: row.agentVersion,
          connectionKind: row.connectionKind,
        };
      }),

    revoke: (serverId, actorUserId) =>
      orUnavailable(() =>
        withTransaction(db, async (client) => {
          const server = await lockServer(client, serverId);
          if (server === undefined) throw new ServerNotFoundError();
          // Idempotent: revoking when nothing is enrolled is still "revoked". An open code goes too, or it could enrol a new agent.
          await deleteOpenCodes(client, server.id);
          if (await revokeCredential(client, server.id)) {
            await recordAuditEvent(client, { action: "agent.revoked", actorUserId, serverId: server.id, detail: {} });
          }
          return { revoked: true as const };
        }),
      ),
  };
}
