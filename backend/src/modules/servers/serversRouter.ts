import { Router } from "express";
import { ServerListResponseSchema, endpoints } from "@satisfactory-dash/shared";
import type { ServerDirectory } from "./serverDirectory.js";
import { createAuthorizeServer, orUnavailable } from "./serverAccess.js";
import type { AuthorizeServerOptions, ServerAccess } from "./serverAccess.js";
import { ServiceUnavailableError, UnauthorizedError } from "../../platform/errorResponse.js";
import { routePath } from "../../platform/routePath.js";
import { sendValidated } from "../../platform/sendValidated.js";

/**
 * ADR-0001: server discovery. Only ids and display names, never a host or port.
 *
 * With `access` (database mode, ADR-0025 PR 6) the list is per user: only servers the user
 * belongs to AND that this process can reach. This router also mounts the membership check on
 * `/servers/:serverId`, so mount it BEFORE the routers that serve the scoped routes. Without
 * `access` (no database) it is the whole directory and there is no per-server check.
 */
export function createServersRouter(
  directory: ServerDirectory<unknown>,
  access?: ServerAccess,
  options: AuthorizeServerOptions & {
    /** ADR-0030: when given, the list says whether this user may manage servers (the operator only). */
    canManage?: (userId: string) => boolean;
  } = {},
): Router {
  const router = Router();
  if (!access) {
    router.get(routePath(endpoints.servers.route), (_req, res) => {
      sendValidated(res, ServerListResponseSchema, { servers: directory.list() });
    });
    return router;
  }
  router.get(routePath(endpoints.servers.route), async (_req, res) => {
    const userId: unknown = res.locals.user?.id;
    if (typeof userId !== "string") {
      throw new UnauthorizedError("Sign in to continue");
    }
    if (options.isReady && !options.isReady()) {
      throw new ServiceUnavailableError();
    }
    // The same membership query that filters the list also gives the user's role on each server (a UX hint the frontend
    // uses to show or hide edit controls; the 403 on writes stays the real control), so there is no extra query.
    const mine = new Map((await orUnavailable(() => access.listForUser(userId))).map((s) => [s.publicId, s.role] as const));
    sendValidated(res, ServerListResponseSchema, {
      servers: directory.list().filter((s) => mine.has(s.id)).map((s) => ({ ...s, role: mine.get(s.id) })),
      ...(options.canManage && { canManageServers: options.canManage(userId) }),
    });
  });
  router.use("/servers/:serverId", createAuthorizeServer(access, options));
  return router;
}
