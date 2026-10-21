import type { RequestHandler } from "express";
import { RateLimitedError, ServiceUnavailableError, UnauthorizedError } from "../../../platform/errorResponse.js";
import { isDatabaseUnavailable } from "../../../platform/db/errors.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import { AUTH_FAILURE_LIMITS, LAST_SEEN_INTERVAL_MS, RECENTLY_VALID_MAX, RECENTLY_VALID_TTL_MS } from "../config.js";
import { rateLimitKey } from "./clientKey.js";
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
  /** FAILED attempts per client network per minute (default 60): an unauthenticated flood must not cost a database lookup each. */
  limiter?: UserRateLimiter;
  /** FAILED attempts across every caller (default 6000 a minute): the per-network table is bounded, so a flood of distinct
   *  addresses must not turn into a lookup each either. */
  globalLimiter?: UserRateLimiter;
  lastSeenIntervalMs?: number;
  /** Tests only: how long a credential that authenticated skips the failure budgets (default 15 min). */
  recentlyValidTtlMs?: number;
  /** Tests only: how many such credentials are remembered (default 1,000). */
  recentlyValidMax?: number;
  now?: () => number;
}

/**
 * #514 (ADR-0045 E3): the failure budgets can't starve a valid agent. Only failed authentications count against them, and
 * an attempt is counted BEFORE its lookup (so a burst of concurrent junk can't all slip past the check) and refunded when
 * it authenticates. A credential that authenticated recently is not checked against them at all: it is still looked up
 * every time (a revocation takes effect at once), but junk from other callers, or from its own network, never refuses it.
 * Authenticated traffic is limited per credential by the routes instead (agentApi.ts).
 */
export function createAgentAuth(options: AgentAuthOptions): RequestHandler {
  const now = options.now ?? Date.now;
  const interval = options.lastSeenIntervalMs ?? LAST_SEEN_INTERVAL_MS;
  const limiter = options.limiter ?? new UserRateLimiter({ ...AUTH_FAILURE_LIMITS.perNetwork, now });
  const globalLimiter = options.globalLimiter ?? new UserRateLimiter({ ...AUTH_FAILURE_LIMITS.global, now });
  const recentlyValid = new RecentlyValid(options.recentlyValidTtlMs ?? RECENTLY_VALID_TTL_MS, options.recentlyValidMax ?? RECENTLY_VALID_MAX);
  const lastTouched = new Map<string, number>();

  return async (req, res, next) => {
    const header = req.headers.authorization;
    const match = typeof header === "string" ? BEARER.exec(header) : null;
    const hash = match === null ? undefined : sha256(match[1]!);
    const hashKey = hash?.toString("base64");
    const network = rateLimitKey(req);
    const refund = (): void => {
      limiter.refund(network);
      globalLimiter.refund("all");
    };
    const counted = hashKey === undefined || !recentlyValid.has(hashKey, now());
    if (counted) {
      // A network over its own budget is refused without touching the process-wide one: no lookup is made for it, so one
      // address hammering must not use up the budget that protects everyone else.
      const networkWait = limiter.hit(network);
      if (networkWait > 0) throw new RateLimitedError(networkWait, "Too many requests. Slow down.");
      const globalWait = globalLimiter.hit("all");
      if (globalWait > 0) {
        limiter.refund(network); // refused before any lookup: not a failure of this network's
        throw new RateLimitedError(globalWait, "Too many requests. Slow down.");
      }
    }
    if (hash === undefined || hashKey === undefined) throw new UnauthorizedError(UNAUTHORIZED_MESSAGE);
    let agent;
    try {
      agent = await findActiveAgent(options.db, hash);
    } catch (err) {
      // Not the caller's failure: give the attempt back, so an outage doesn't use up the budgets of valid agents.
      if (counted) refund();
      if (isDatabaseUnavailable(err)) throw Object.assign(new ServiceUnavailableError(), { cause: err });
      throw err;
    }
    if (agent === undefined) {
      if (!counted) {
        // A credential revoked since it last worked: forget it, and count this failure like any other.
        recentlyValid.delete(hashKey);
        limiter.hit(network);
        globalLimiter.hit("all");
      }
      throw new UnauthorizedError(UNAUTHORIZED_MESSAGE);
    }
    if (counted) refund();
    recentlyValid.remember(hashKey, now());
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

/** Credential hashes (never the secrets) that authenticated within `ttlMs`, at most `max` of them, oldest dropped first. */
class RecentlyValid {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly max: number,
  ) {}

  has(hashKey: string, at: number): boolean {
    const last = this.seen.get(hashKey);
    return last !== undefined && at - last < this.ttlMs;
  }

  remember(hashKey: string, at: number): void {
    this.seen.delete(hashKey); // re-insert, so Map order is oldest first
    if (this.seen.size >= this.max) this.seen.delete(this.seen.keys().next().value as string);
    this.seen.set(hashKey, at);
  }

  delete(hashKey: string): void {
    this.seen.delete(hashKey);
  }
}
