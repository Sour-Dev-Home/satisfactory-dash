import type { AgentStatusResponseSchema, EnrollmentCodeResponseSchema, RevokeAgentResponseSchema } from "@satisfactory-dash/shared";
import { AGENT_OFFLINE_DEFAULT_SECONDS } from "@satisfactory-dash/shared";
import type { z } from "zod";
import { ForbiddenError, RateLimitedError, ServerNotFoundError, ServiceUnavailableError } from "../../../platform/errorResponse.js";
import { isDatabaseUnavailable } from "../../../platform/db/errors.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { withTransaction } from "../../../platform/db/transaction.js";
import { recordAuditEvent } from "../../../platform/audit/auditRepository.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import { ENROLLMENT_CODES_PER_HOUR_DEFAULT, ENROLLMENT_CODES_PER_MINUTE, ENROLLMENT_CODE_TTL_MS } from "../config.js";
import { deleteOpenCodes, getAgentStatus, insertCode, lockServer, revokeCredential, sha256 } from "../repositories/agentRepository.js";
import type { AgentStatusRow } from "../repositories/agentRepository.js";
import { generateEnrollmentCode } from "./enrollmentCode.js";
import type { GameConnection } from "./gameConnection.js";

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
  /** ADR-0046 C7 (#527): codes per user per hour, in addition to the minute limit; the operator (`canManage`) is exempt. */
  hourlyLimiter?: UserRateLimiter;
  /** The hourly cap when no `hourlyLimiter` is given; default 20 (`ENROLLMENT_CODES_PER_HOUR`, validated at startup). */
  codesPerHour?: number;
  now?: () => number;
  /** When the backend last received a snapshot from this server's agent (ms), from memory; undefined before the first one.
   *  The composition root reads it from the server's observations. */
  lastHeardAt?: (serverId: string) => number | undefined;
  /** #740 follow-up: the game connection the agent reported in its latest snapshot since this process started, from memory
   *  (`GameConnectionStore.get`); undefined before the first one, when the database copy is used instead. */
  gameConnection?: (serverId: string) => GameConnection | undefined;
}

/** The status's game connection fields: the memory when it has heard from the agent since the start, else the database
 *  copy; `lastGameReadAt` is the later of the two (it only moves forward). Each is left out when not reported. */
function gameConnectionFields(row: AgentStatusRow, memory: GameConnection | undefined): Pick<AgentStatusBody, "gameReachable" | "lastGameReadAt" | "modVersion"> {
  const gameReachable = memory ? memory.gameReachable : row.gameReachable;
  const modVersion = memory ? memory.modVersion : row.modVersion;
  const stored = row.lastGameReadAt?.getTime() ?? null;
  const memoryReadAt = memory?.lastGameReadAt ?? null;
  const readAt = stored === null ? memoryReadAt : memoryReadAt === null ? stored : Math.max(stored, memoryReadAt);
  return {
    ...(gameReachable !== null ? { gameReachable } : {}),
    ...(readAt !== null ? { lastGameReadAt: new Date(readAt).toISOString() } : {}),
    ...(modVersion !== null ? { modVersion } : {}),
  };
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
  const limiter = deps.limiter ?? new UserRateLimiter({ max: ENROLLMENT_CODES_PER_MINUTE, windowMs: 60_000, now });
  const hourlyLimiter =
    deps.hourlyLimiter ?? new UserRateLimiter({ max: deps.codesPerHour ?? ENROLLMENT_CODES_PER_HOUR_DEFAULT, windowMs: 3_600_000, now });

  return {
    createEnrollmentCode: (serverId, actorUserId) =>
      orUnavailable(async () => {
        const wait = limiter.hit(actorUserId);
        if (wait > 0) throw new RateLimitedError(wait, "Too many enrollment codes. Try again in a moment.");
        // Both limits are checked before the transaction. The operator re-enrols their own servers in bulk after a
        // restore, so they only have the minute limit. A refused hourly hit gives its minute slot back.
        if (!deps.canManage(actorUserId)) {
          const hourlyWait = hourlyLimiter.hit(actorUserId);
          if (hourlyWait > 0) {
            limiter.refund(actorUserId);
            throw new RateLimitedError(hourlyWait, "Too many enrollment codes this hour. Try again later.");
          }
        }
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
          // Only for an enrolled agent: a revoked one's row reads as nulls, and the memory is not asked.
          ...(row.enrolled ? gameConnectionFields(row, deps.gameConnection?.(serverId)) : {}),
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
