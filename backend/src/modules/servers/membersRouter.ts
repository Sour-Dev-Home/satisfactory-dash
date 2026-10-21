import { Router } from "express";
import { LeaveServerResponseSchema, ServerIdSchema, endpoints } from "@satisfactory-dash/shared";
import { ApiFailure, InvalidServerIdError, RateLimitedError, ServerNotFoundError } from "../../platform/errorResponse.js";
import type { Queryable } from "../../platform/db/schemaVersion.js";
import { routePath } from "../../platform/routePath.js";
import { sendValidated } from "../../platform/sendValidated.js";
import { UserRateLimiter } from "../../platform/userRateLimiter.js";
import { leaveServer } from "./repositories/memberRepository.js";
import type { LeaveServerResult } from "./repositories/memberRepository.js";
import { orUnavailable } from "./serverAccess.js";
import { userId } from "./serverManagementRouter.js";

/** What the members routes need: today only leaving (ADR-0047 decision 4). The route test uses a fake. */
export interface MemberSelfService {
  leave(publicId: string, userId: string): Promise<LeaveServerResult>;
}

export function createDbMemberSelfService(db: Queryable): MemberSelfService {
  return { leave: (publicId, actor) => leaveServer(db, { publicId, userId: actor }) };
}

export interface MembersRouterOptions {
  /** Injectable for tests. */
  limiter?: UserRateLimiter;
}

const LEAVE_LIMIT = { max: 30, windowMs: 15 * 60 * 1000 };
const RATE_LIMITED_MESSAGE = "Too many requests. Try again later.";
export const LAST_OWNER_MESSAGE = "You own this server. Remove it from Satisfactory Dash instead of leaving it.";

/**
 * ADR-0047: POST /api/servers/:serverId/members/me/leave. Mount AFTER the servers router: its membership check answers a
 * non-member with the unknown-server 404 and lets any member, a viewer included, make this write (the contract's
 * `memberSelfService`). The handler acts on the signed-in user only (no user id in the path or the body). The owner is
 * refused with 409 `would_orphan`, reason `last_owner`, and nothing changes. No fresh sign-in is needed: leaving is
 * reversible by an invite and touches nobody else's data.
 */
export function createMembersRouter(service: MemberSelfService, options: MembersRouterOptions = {}): Router {
  const limiter = options.limiter ?? new UserRateLimiter(LEAVE_LIMIT);
  const router = Router();

  router.post(routePath(endpoints.members.leave.route), async (req, res) => {
    const actor = userId(res);
    const parsed = ServerIdSchema.safeParse(req.params.serverId);
    if (!parsed.success) throw new InvalidServerIdError();
    const retryAfter = limiter.hit(actor);
    if (retryAfter > 0) throw new RateLimitedError(retryAfter, RATE_LIMITED_MESSAGE);
    const outcome = await orUnavailable(() => service.leave(parsed.data, actor));
    if (outcome === "last_owner") throw new ApiFailure("would_orphan", LAST_OWNER_MESSAGE, "last_owner");
    // The membership check passed a moment ago, so this is a race (removed, or left in another tab): the same 404.
    if (outcome === "not_member") throw new ServerNotFoundError();
    req.log.info({ userId: actor }, "left a server");
    sendValidated(res, LeaveServerResponseSchema, { left: true });
  });

  return router;
}
