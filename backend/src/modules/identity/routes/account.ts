import { Router } from "express";
import { DeleteAccountResponseSchema, endpoints } from "@satisfactory-dash/shared";
import { ApiFailure, RateLimitedError, ServiceUnavailableError, UnauthorizedError } from "../../../platform/errorResponse.js";
import { isDatabaseUnavailable } from "../../../platform/db/errors.js";
import { routePath } from "../../../platform/routePath.js";
import { sendValidated } from "../../../platform/sendValidated.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import type { AccountDeletion } from "../accountDeletion.js";
import { hashSessionId } from "../repositories/sessionRepository.js";
import { clearSessionCookie, readSessionCookie } from "../session.js";

export interface AccountRouterOptions {
  /** Injectable for tests. */
  limiter?: UserRateLimiter;
}

const DELETE_LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };
const RATE_LIMITED_MESSAGE = "Too many requests. Try again later.";
export const REAUTH_MESSAGE = "Sign in again to delete your account.";
export const OPERATOR_ACCOUNT_MESSAGE = "The operator's account can't be deleted.";
export const OPERATOR_SERVERS_MESSAGE =
  "You own servers the operator set up. They need a new owner before your account can be deleted: contact the operator.";

/**
 * ADR-0047: DELETE /api/account, the signed-in user deletes their own account. Mounted behind the session guard, database
 * mode only. No body. The refusals (ADR-0047 decision 6): 403 `forbidden` reason `operator_account`; 403 `reauth_required`
 * when the session's sign-in is older than 10 minutes (403, not 401, so the client does not read it as "signed out"); 409
 * `would_orphan` reason `operator_servers` with the blocking servers in `servers`. On success the session is gone with the
 * account (the cascade), and the cookie is cleared.
 */
export function createAccountRouter(deletion: AccountDeletion, options: AccountRouterOptions = {}): Router {
  const limiter = options.limiter ?? new UserRateLimiter(DELETE_LIMIT);
  const router = Router();

  router.delete(routePath(endpoints.account.remove.route), async (req, res) => {
    const id: unknown = res.locals.user?.id;
    const cookie = readSessionCookie(req);
    if (typeof id !== "string" || cookie === undefined) throw new UnauthorizedError("Sign in to continue");
    const retryAfter = limiter.hit(id);
    if (retryAfter > 0) throw new RateLimitedError(retryAfter, RATE_LIMITED_MESSAGE);
    let result;
    try {
      result = await deletion.deleteAccount({ userId: id, sessionIdHash: hashSessionId(cookie) });
    } catch (err) {
      if (isDatabaseUnavailable(err)) throw Object.assign(new ServiceUnavailableError(), { cause: err });
      throw err;
    }
    switch (result.outcome) {
      case "operator_account":
        throw new ApiFailure("forbidden", OPERATOR_ACCOUNT_MESSAGE, "operator_account");
      case "reauth_required":
        throw new ApiFailure("reauth_required", REAUTH_MESSAGE);
      case "operator_servers":
        throw new ApiFailure("would_orphan", OPERATOR_SERVERS_MESSAGE, "operator_servers", result.servers);
      case "not_found":
        // Deleted a moment ago (another tab): the session went with it.
        clearSessionCookie(res);
        throw new UnauthorizedError("Sign in to continue");
      case "deleted":
        clearSessionCookie(res);
        // Ids and counts only (the privacy page: sign-in and account logs carry ids).
        req.log.info({ userId: id, serversDeleted: result.serversDeleted, membershipsLeft: result.membershipsLeft }, "account deleted");
        sendValidated(res, DeleteAccountResponseSchema, { deleted: true });
    }
  });

  return router;
}
