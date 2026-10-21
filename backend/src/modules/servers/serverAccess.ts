import type { RequestHandler } from "express";
import { ServerIdSchema, endpoints } from "@satisfactory-dash/shared";
import {
  ForbiddenError,
  InvalidServerIdError,
  ServerNotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
} from "../../platform/errorResponse.js";
import { isDatabaseUnavailable } from "../../platform/db/errors.js";
import type { Queryable } from "../../platform/db/schemaVersion.js";
import { getMemberRole } from "./repositories/memberRepository.js";
import { listServersForUser } from "./repositories/serverRepository.js";
import type { MemberRole, UserServer } from "./repositories/serverRepository.js";

/**
 * ADR-0025 decision "authorization": who may see and change which server. The middleware and the
 * list route depend on this interface, not on the database, so they are tested with a Map.
 */
export interface ServerAccess {
  /** The user's role on the server with this public id; undefined for a non-member, a deleted
   *  server and an unknown one alike (the caller answers all three with the same 404). */
  getRole(publicId: string, userId: string): Promise<MemberRole | undefined>;
  /** Only the servers this user belongs to. */
  listForUser(userId: string): Promise<UserServer[]>;
}

export function createDbServerAccess(db: Queryable): ServerAccess {
  return {
    getRole: (publicId, userId) => getMemberRole(db, { publicId, userId }),
    listForUser: (userId) => listServersForUser(db, userId),
  };
}

/** A database outage is a 503 (never a 404 or a 401: an outage must not look like "not a
 *  member"); any other failure stays a 500. */
export async function orUnavailable<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isDatabaseUnavailable(err)) {
      throw Object.assign(new ServiceUnavailableError(), { cause: err });
    }
    throw err;
  }
}

/** Reading is allowed to every member; anything else needs the owner or an admin. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const WRITE_ROLES = new Set<MemberRole>(["owner", "admin"]);

/**
 * The writes any MEMBER may make, viewers included: those the contract flags `memberSelfService` (a member's own push
 * opt-in, ADR-0044; leaving the server, ADR-0047). Each changes only the caller's own relation to the server, and its
 * handler scopes it to the signed-in user. Matched exactly (method and the literal path below the mount), collected from
 * the contract's flag, so a new write route is never exempt by accident and a newly flagged one needs no change here.
 */
const SCOPED_PREFIX = "/api/servers/:serverId";
function memberSelfServiceRoutes(node: unknown): string[] {
  if (typeof node !== "object" || node === null) return [];
  const entry = node as { method?: unknown; route?: unknown; memberSelfService?: unknown };
  if (typeof entry.route === "string" && typeof entry.method === "string") {
    if (entry.memberSelfService !== true) return [];
    // Only literal paths below a server (no other `:param`), so the exact match below is well defined.
    if (!entry.route.startsWith(`${SCOPED_PREFIX}/`) || entry.route.slice(SCOPED_PREFIX.length).includes(":")) {
      throw new Error(`memberSelfService endpoint ${entry.method} ${entry.route} must be a literal path below ${SCOPED_PREFIX}`);
    }
    return [`${entry.method} ${entry.route.slice(SCOPED_PREFIX.length)}`];
  }
  return Object.values(node).flatMap(memberSelfServiceRoutes);
}
export const MEMBER_SELF_SERVICE: ReadonlySet<string> = new Set(memberSelfServiceRoutes(endpoints));
function isMemberSelfService(method: string, path: string): boolean {
  return MEMBER_SELF_SERVICE.has(`${method} ${path}`);
}

export interface AuthorizeServerOptions {
  /** False until the configured servers are registered at startup: answered with a 503 rather
   *  than a 404 that would tell a real member the server does not exist. */
  isReady?: () => boolean;
}

/**
 * Mounted once, on `/servers/:serverId`, so every route below it is covered and a new one cannot
 * skip the check. Needs `res.locals.user` (the session guard runs first). A non-member gets the
 * same 404 as an unknown server (existence is not revealed); a viewer trying a write gets 403
 * `forbidden`. Sets `res.locals.serverRole` for the routes.
 */
export function createAuthorizeServer(access: ServerAccess, options: AuthorizeServerOptions = {}): RequestHandler {
  return async (req, res, next) => {
    const parsed = ServerIdSchema.safeParse(req.params.serverId);
    if (!parsed.success) {
      throw new InvalidServerIdError();
    }
    const userId: unknown = res.locals.user?.id;
    if (typeof userId !== "string") {
      throw new UnauthorizedError("Sign in to continue");
    }
    if (options.isReady && !options.isReady()) {
      throw new ServiceUnavailableError();
    }
    const role = await orUnavailable(() => access.getRole(parsed.data, userId));
    if (role === undefined) {
      throw new ServerNotFoundError();
    }
    if (!READ_METHODS.has(req.method) && !WRITE_ROLES.has(role) && !isMemberSelfService(req.method, req.path)) {
      throw new ForbiddenError();
    }
    res.locals.serverRole = role;
    next();
  };
}
