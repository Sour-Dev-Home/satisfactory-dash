import { Router } from "express";
import type { RequestHandler } from "express";
import type { z } from "zod";
import {
  CreateServerRequestSchema,
  DeleteServerResponseSchema,
  ManagedServerListResponseSchema,
  ServerConnectionResponseSchema,
  ServerIdSchema,
  TestConnectionRequestSchema,
  TestConnectionResponseSchema,
  UpdateServerRequestSchema,
  endpoints,
} from "@satisfactory-dash/shared";
import {
  BadRequestError,
  ForbiddenError,
  InvalidServerIdError,
  RateLimitedError,
  ServiceUnavailableError,
  UnauthorizedError,
} from "../../platform/errorResponse.js";
import { routePath } from "../../platform/routePath.js";
import { sendValidated } from "../../platform/sendValidated.js";
import { UserRateLimiter } from "../../platform/userRateLimiter.js";
import { orUnavailable } from "./serverAccess.js";
import type { ServerManagementService } from "./serverManagement.js";

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
 * Tokens are write-only: a request carries them, a response never does, and no body is ever logged.
 * The write routes are rate limited per user, and the test-connection routes more tightly (each one
 * opens outbound connections).
 */
export interface ServerManagementRouterOptions {
  /** False until the database is up and the servers are loaded: answered with a 503. */
  isReady?: () => boolean;
  /** Injectable for tests. */
  writeLimiter?: UserRateLimiter;
  testLimiter?: UserRateLimiter;
}

const WRITE_LIMIT = { max: 30, windowMs: 15 * 60 * 1000 };
const TEST_LIMIT = { max: 10, windowMs: 60 * 1000 };
const RATE_LIMITED_MESSAGE = "Too many requests. Try again later.";

/** A body that fails its schema is a 400 naming the fields, never the values (a token may be among them). */
function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const problems = parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "(body)"}: ${issue.message}`);
    throw new BadRequestError(`Invalid request: ${problems.join("; ")}`);
  }
  return parsed.data;
}

function userId(res: { locals: { user?: { id?: unknown } } }): string {
  const id = res.locals.user?.id;
  if (typeof id !== "string") throw new UnauthorizedError("Sign in to continue");
  return id;
}

export function createServerManagementRouters(
  service: ServerManagementService,
  options: ServerManagementRouterOptions = {},
): { collection: Router; scoped: Router } {
  const writeLimiter = options.writeLimiter ?? new UserRateLimiter(WRITE_LIMIT);
  const testLimiter = options.testLimiter ?? new UserRateLimiter(TEST_LIMIT);

  const operatorOnly: RequestHandler = (_req, res, next) => {
    const id = userId(res);
    if (options.isReady && !options.isReady()) throw new ServiceUnavailableError();
    if (!service.canManage(id)) throw new ForbiddenError("Only the operator can manage servers.");
    next();
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

  const { create, list, testConnection, get, update, remove, testSaved } = endpoints.serverManagement;

  const collection = Router();
  // "managed" is a reserved server id, and this router is mounted before the servers router, so the
  // list is never read as GET /servers/:serverId.
  collection.get(routePath(list.route), operatorOnly, async (_req, res) => {
    sendValidated(res, ManagedServerListResponseSchema, { servers: await orUnavailable(() => service.list()) });
  });
  collection.post(routePath(create.route), operatorOnly, limited(writeLimiter), async (req, res) => {
    const body = parseBody(CreateServerRequestSchema, req.body);
    const server = await orUnavailable(() => service.create(userId(res), body));
    res.status(201);
    sendValidated(res, ServerConnectionResponseSchema, { server });
  });
  collection.post(routePath(testConnection.route), operatorOnly, limited(testLimiter), async (req, res) => {
    const body = parseBody(TestConnectionRequestSchema, req.body);
    sendValidated(res, TestConnectionResponseSchema, await orUnavailable(() => service.testCandidate(body)));
  });

  const scoped = Router();
  scoped.get(routePath(get.route), operatorOnly, async (req, res) => {
    const server = await orUnavailable(() => service.get(serverId(req.params.serverId)));
    sendValidated(res, ServerConnectionResponseSchema, { server });
  });
  scoped.patch(routePath(update.route), operatorOnly, limited(writeLimiter), async (req, res) => {
    const id = serverId(req.params.serverId);
    const body = parseBody(UpdateServerRequestSchema, req.body);
    const server = await orUnavailable(() => service.update(userId(res), id, body));
    sendValidated(res, ServerConnectionResponseSchema, { server });
  });
  scoped.delete(routePath(remove.route), operatorOnly, limited(writeLimiter), async (req, res) => {
    await orUnavailable(() => service.remove(userId(res), serverId(req.params.serverId)));
    sendValidated(res, DeleteServerResponseSchema, { deleted: true });
  });
  scoped.post(routePath(testSaved.route), operatorOnly, limited(testLimiter), async (req, res) => {
    sendValidated(res, TestConnectionResponseSchema, await orUnavailable(() => service.testSaved(serverId(req.params.serverId))));
  });

  return { collection, scoped };
}
