import { Router } from "express";
import { ServerListResponseSchema, endpoints } from "@satisfactory-dash/shared";
import type { ServerDirectory } from "./serverDirectory.js";
import { routePath } from "../../platform/routePath.js";
import { sendValidated } from "../../platform/sendValidated.js";

/** ADR-0001: server discovery. Only ids and display names, never a host or port. */
export function createServersRouter(directory: ServerDirectory<unknown>): Router {
  const router = Router();
  router.get(routePath(endpoints.servers.route), (_req, res) => {
    sendValidated(res, ServerListResponseSchema, { servers: directory.list() });
  });
  return router;
}
