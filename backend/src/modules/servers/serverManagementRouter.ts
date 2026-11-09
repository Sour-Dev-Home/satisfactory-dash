import { Router } from "express";
import type { RequestHandler } from "express";
import type { z } from "zod";
import {
  DeleteServerResponseSchema,
  ManagedServerListResponseSchema,
  RenameServerRequestSchema,
  RenameServerResponseSchema,
  ServerIdSchema,
  endpoints,
} from "@satisfactory-dash/shared";
import {
  BadRequestError,
  InvalidServerIdError,
  RateLimitedError,
  RouteGoneError,
  ServiceUnavailableError,
  UnauthorizedError,
} from "../../platform/errorResponse.js";
import { assertOperator, requireOperator } from "../identity/index.js";
import { routePath } from "../../platform/routePath.js";
import { sendValidated } from "../../platform/sendValidated.js";
import { UserRateLimiter } from "../../platform/userRateLimiter.js";
import { orUnavailable } from "./serverAccess.js";
import type { ServerManagementService } from "./serverManagement.js";
import { NOT_SELF_SERVE } from "./selfServe.js";
import type { SelfServeService } from "./selfServe.js";

/**
 * ADR-0030's routes for managing servers. EVERY one is operator only (the seeded operator account;
 * an owner or admin membership is not enough), answered 403 for anyone else. The routes are split in
 * two so the composition root can mount each where it belongs:
 *
 * - `collection`: the routes with no server in the path (POST /servers, GET /servers/managed,
 *   POST /servers/test-connection). Mount BEFORE the servers router, or `managed` and `test-connection`
 *   would be read as server ids.
 * - `scoped`: the routes under /servers/:serverId. Mount AFTER the servers router, so its membership
 *   check runs first (a non-member gets the same 404 as an unknown server, a viewer's write a 403).
 *
 * ADR-0066 build PR 5: direct polling is retired. The managed list sends `servers: []` (the field is still required by the
 * contract) and the direct-poll routes (create, get, update, test-connection, test the saved connection, switch to local)
 * still pass the operator gate, then answer 410 with a message that servers connect through the mod. Build PR 6 deletes
 * them. The write routes are rate limited per user.
 *
 * #526 (ADR-0046 section 1.8): the two routes the contract flags `selfServeOwner` (rename an agent server, remove) also
 * accept the OWNER of a self-serve server. For a caller whose role on the server is owner the owner path runs first; it
 * re-checks self-serve and ownership under the server's row lock, and an operator-created server falls through to the
 * operator-only rule, unchanged. Admins and viewers stay 403, non-members 404 (the membership check runs first).
 */
export interface ServerManagementRouterOptions {
  /** False until the database is up and the servers are loaded: answered with a 503. */
  isReady?: () => boolean;
  /** The self-serve owner's rename and remove. Without it, those routes are operator only. */
  selfServeOwner?: Pick<SelfServeService, "renameAsOwner" | "removeAsOwner">;
  /** Injectable for tests. */
  writeLimiter?: UserRateLimiter;
}

const WRITE_LIMIT = { max: 30, windowMs: 15 * 60 * 1000 };
const RATE_LIMITED_MESSAGE = "Too many requests. Try again later.";

/** ADR-0066: what a retired direct-poll route answers (410, code `not_found`; see `RouteGoneError`). */
export const DIRECT_POLL_GONE_MESSAGE =
  "Direct connections to game servers are retired: servers connect through the mod. Add a server, then enrol the mod with its code.";

/** A body that fails its schema is a 400 naming the fields, never the values (a token may be among them). */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const problems = parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "(body)"}: ${issue.message}`);
    throw new BadRequestError(`Invalid request: ${problems.join("; ")}`);
  }
  return parsed.data;
}

export function userId(res: { locals: { user?: { id?: unknown } } }): string {
  const id = res.locals.user?.id;
  if (typeof id !== "string") throw new UnauthorizedError("Sign in to continue");
  return id;
}

export function createServerManagementRouters(
  service: ServerManagementService,
  options: ServerManagementRouterOptions = {},
): { collection: Router; scoped: Router } {
  const writeLimiter = options.writeLimiter ?? new UserRateLimiter(WRITE_LIMIT);

  // ADR-0056 section 3: the operator gate lives in identity and serves servers and metrics alike; same 401/503/403 as before.
  const operatorRule = { isOperator: (id: string) => service.canManage(id), forbiddenMessage: "Only the operator can manage servers." };
  const operatorOnly: RequestHandler = requireOperator({ ...operatorRule, isReady: () => options.isReady?.() ?? true });
  // #526: the `selfServeOwner` routes let an owner through to the handler, which tries the owner path first.
  const selfServeOwner = options.selfServeOwner;
  const isOwnerCaller = (res: { locals: Record<string, unknown> }): boolean => selfServeOwner !== undefined && res.locals.serverRole === "owner";
  const operatorOrSelfServeOwner: RequestHandler = (req, res, next) => {
    if (!isOwnerCaller(res)) return operatorOnly(req, res, next);
    userId(res);
    if (options.isReady && !options.isReady()) throw new ServiceUnavailableError();
    next();
  };
  /** After the owner path answered NOT_SELF_SERVE (an operator-created server): the operator-only rule, as before. */
  const requireOperatorOf = (res: { locals: { user?: { id?: unknown } } }): void => {
    assertOperator(res, operatorRule);
  };
  const limited =
    (limiter: UserRateLimiter): RequestHandler =>
    (_req, res, next) => {
      const retryAfter = limiter.hit(userId(res));
      if (retryAfter > 0) throw new RateLimitedError(retryAfter, RATE_LIMITED_MESSAGE);
      next();
    };
  const serverId = (raw: unknown): string => {
    const parsed = ServerIdSchema.safeParse(raw);
    if (!parsed.success) throw new InvalidServerIdError();
    return parsed.data;
  };

  const { create, list, testConnection, get, update, renameAgent, switchToLocal, remove, testSaved } = endpoints.serverManagement;

  /** ADR-0066: a retired direct-poll route. Nothing is read, written or tested, and the body is ignored. */
  const gone: RequestHandler = () => {
    throw new RouteGoneError(DIRECT_POLL_GONE_MESSAGE);
  };

  const collection = Router();
  // "managed" is a reserved server id, and this router is mounted before the servers router, so the
  // list is never read as GET /servers/:serverId.
  collection.get(routePath(list.route), operatorOnly, async (_req, res) => {
    // ADR-0066 Decision 8 step A: no server has a stored connection any more; `servers` stays, empty, until the contract PR.
    const agentServers = await orUnavailable(() => service.listAgentServers());
    sendValidated(res, ManagedServerListResponseSchema, { servers: [], agentServers });
  });
  collection.post(routePath(create.route), operatorOnly, gone);
  collection.post(routePath(testConnection.route), operatorOnly, gone);

  const scoped = Router();
  scoped.get(routePath(get.route), operatorOnly, gone);
  scoped.patch(routePath(update.route), operatorOnly, gone);
  scoped.post(routePath(switchToLocal.route), operatorOnly, gone);
  // ADR-0031: the one edit a server reached through an edge agent has.
  // #526: flagged `selfServeOwner` in the contract, so a self-serve server's owner may rename it too.
  scoped.patch(routePath(renameAgent.route), renameAgent.selfServeOwner ? operatorOrSelfServeOwner : operatorOnly, limited(writeLimiter), async (req, res) => {
    const id = serverId(req.params.serverId);
    const body = parseBody(RenameServerRequestSchema, req.body);
    if (isOwnerCaller(res)) {
      const owned = await orUnavailable(() => selfServeOwner!.renameAsOwner(userId(res), id, body.displayName));
      if (owned !== NOT_SELF_SERVE) return sendValidated(res, RenameServerResponseSchema, { server: owned });
      requireOperatorOf(res);
    }
    sendValidated(res, RenameServerResponseSchema, { server: await orUnavailable(() => service.renameAgentServer(userId(res), id, body.displayName)) });
  });
  // #526: flagged `selfServeOwner` too: the owner removes their self-serve server through the same purge.
  scoped.delete(routePath(remove.route), remove.selfServeOwner ? operatorOrSelfServeOwner : operatorOnly, limited(writeLimiter), async (req, res) => {
    const id = serverId(req.params.serverId);
    if (isOwnerCaller(res)) {
      const owned = await orUnavailable(() => selfServeOwner!.removeAsOwner(userId(res), id));
      if (owned !== NOT_SELF_SERVE) return sendValidated(res, DeleteServerResponseSchema, { deleted: true });
      requireOperatorOf(res);
    }
    await orUnavailable(() => service.remove(userId(res), id));
    sendValidated(res, DeleteServerResponseSchema, { deleted: true });
  });
  scoped.post(routePath(testSaved.route), operatorOnly, gone);

  return { collection, scoped };
}
