import type { Request } from "express";
import { ServerIdSchema } from "@satisfactory-dash/shared";
import type { ServerDirectory } from "./serverDirectory.js";
import { InvalidServerIdError, ServerNotFoundError } from "../../platform/errorResponse.js";

/**
 * ADR-0001: resolves :serverId to that server's services. A malformed id is a 400
 * bad_request and an unknown one a 404 server_not_found, both via the error middleware.
 */
export function resolveServer<TServices>(
  directory: ServerDirectory<TServices>,
  req: Request,
): { serverId: string; services: TServices } {
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
