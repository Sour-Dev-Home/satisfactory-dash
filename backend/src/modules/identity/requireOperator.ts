import type { RequestHandler } from "express";
import { ForbiddenError, ServiceUnavailableError, UnauthorizedError } from "../../platform/errorResponse.js";

/**
 * ADR-0056 section 3: the one operator gate (ADR-0030). "Operator" is the seeded operator account, and nobody else.
 * It answers 401 when nobody is signed in and 403 `ForbiddenError` for everyone else (the repo is public, so a route's
 * existence is no secret and 403 matches the error taxonomy). A future admin role (ADR-0020) replaces `isOperator`.
 *
 * Order, kept from the servers router it was moved out of: signed in (401), then ready (503), then operator (403).
 */
export interface RequireOperatorOptions {
  /** True for the seeded operator's user id. */
  isOperator: (userId: string) => boolean;
  /** When given and false, the gate answers 503 (the servers are not registered yet). */
  isReady?: () => boolean;
  /** The 403 message, so each route family keeps its own wording. */
  forbiddenMessage: string;
}

/** The signed-in user's id from the session guard, or 401. */
export function signedInUserId(res: { locals: { user?: { id?: unknown } } }): string {
  const id = res.locals.user?.id;
  if (typeof id !== "string") throw new UnauthorizedError("Sign in to continue");
  return id;
}

/** Throws unless the signed-in caller is the operator (401 signed out, 403 anyone else). Returns the operator's id. */
export function assertOperator(res: { locals: { user?: { id?: unknown } } }, options: Pick<RequireOperatorOptions, "isOperator" | "forbiddenMessage">): string {
  const id = signedInUserId(res);
  if (!options.isOperator(id)) throw new ForbiddenError(options.forbiddenMessage);
  return id;
}

/** Express middleware: only the operator gets through. Mount it after the session guard. */
export function requireOperator(options: RequireOperatorOptions): RequestHandler {
  return (_req, res, next) => {
    const id = signedInUserId(res);
    if (options.isReady && !options.isReady()) throw new ServiceUnavailableError();
    if (!options.isOperator(id)) throw new ForbiddenError(options.forbiddenMessage);
    next();
  };
}
