import type { Request } from "express";
import { ServerIdSchema } from "@satisfactory-dash/shared";
import type { ServerDirectory, ServerServices } from "../services/serverDirectory.js";
import { InvalidServerIdError, ServerNotFoundError } from "./errorResponse.js";

/** The routers are mounted under /api (app.ts), so a shared endpoint's route pattern
 *  (e.g. "/api/servers/:serverId/power") is registered without that prefix. Using the
 *  contract's own pattern keeps the backend and the frontend's path builders in step. */
export function routePath(route: string): string {
  return route.replace(/^\/api(?=\/)/, "");
}

/**
 * ADR-0001: resolves :serverId to that server's services. A malformed id is a 400
 * bad_request and an unknown one a 404 server_not_found, both via the error middleware.
 */
export function resolveServer(directory: ServerDirectory, req: Request): { serverId: string; services: ServerServices } {
  const parsed = ServerIdSchema.safeParse(req.params.serverId);
  if (!parsed.success) {
    throw new InvalidServerIdError();
  }
  const services = directory.get(parsed.data);
  if (!services) {
    throw new ServerNotFoundError();
  }
  return { serverId: parsed.data, services };
}

/**
 * ADR-0004's snapshot envelope. Request-through today (ADR-0010): the data was just
 * read from the game server, so observedAt is now and it is never stale. A future
 * poller serves its last snapshot here instead, without a contract change.
 */
export function snapshot<T>(serverId: string, data: T): { serverId: string; observedAt: string; stale: boolean; data: T } {
  return { serverId, observedAt: new Date().toISOString(), stale: false, data };
}
