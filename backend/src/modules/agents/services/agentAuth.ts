import type { RequestHandler } from "express";
import { RateLimitedError, ServiceUnavailableError, UnauthorizedError } from "../../../platform/errorResponse.js";
import { clientIp } from "../../../platform/clientIp.js";
import { isDatabaseUnavailable } from "../../../platform/db/errors.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import { LAST_SEEN_INTERVAL_MS } from "../config.js";
import { findActiveAgent, sha256, touchAgent } from "../repositories/agentRepository.js";

/**
 * ADR-0031 PR 5a: who an agent request is. `Authorization: Bearer <secret>` is hashed and looked up; an unknown, revoked
 * or malformed credential, and a credential of a removed server, are ALL the same 401 `unauthorized` (no oracle for what
 * exists). On success `res.locals.agent` names the server, and `last_seen_at` is written at most once per interval per
 * server. The header is never logged (the request logger redacts `authorization`, and nothing here logs it).
 *
 * A database outage is a 503, never a 401: an agent that gets 401 stops and asks its owner to re-enrol, and an outage
 * must not look like a revoked credential.
 */
export interface AgentIdentity {
  /** The internal server uuid, as text. Never sent to a client. */
  serverUuid: string;
  /** The server's public id. */
  publicId: string;
}

const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;
const UNAUTHORIZED_MESSAGE = "The agent credential is missing or not valid";

export interface AgentAuthOptions {
  db: Queryable;
  /** Failed and successful attempts per client address per minute: an unauthenticated flood must not cost a database lookup each. */
  limiter?: UserRateLimiter;
  lastSeenIntervalMs?: number;
  now?: () => number;
}

export function createAgentAuth(options: AgentAuthOptions): RequestHandler {
  const now = options.now ?? Date.now;
  const interval = options.lastSeenIntervalMs ?? LAST_SEEN_INTERVAL_MS;
  const limiter = options.limiter ?? new UserRateLimiter({ max: 600, windowMs: 60_000 });
  const lastTouched = new Map<string, number>();

  return async (req, res, next) => {
    const wait = limiter.hit(clientIp(req));
    if (wait > 0) throw new RateLimitedError(wait, "Too many requests. Slow down.");
    const header = req.headers.authorization;
    const match = typeof header === "string" ? BEARER.exec(header) : null;
    if (match === null) throw new UnauthorizedError(UNAUTHORIZED_MESSAGE);
    let agent;
    try {
      agent = await findActiveAgent(options.db, sha256(match[1]!));
    } catch (err) {
      if (isDatabaseUnavailable(err)) throw Object.assign(new ServiceUnavailableError(), { cause: err });
      throw err;
    }
    if (agent === undefined) throw new UnauthorizedError(UNAUTHORIZED_MESSAGE);
    const at = now();
    const last = lastTouched.get(agent.serverUuid);
    if (last === undefined || at - last >= interval) {
      lastTouched.set(agent.serverUuid, at);
      // Best effort: liveness is a hint, and a failed write must never fail the agent's request.
      void touchAgent(options.db, agent.serverUuid).catch(() => lastTouched.delete(agent.serverUuid));
    }
    res.locals.agent = { serverUuid: agent.serverUuid, publicId: agent.publicId } satisfies AgentIdentity;
    next();
  };
}
