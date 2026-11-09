import { Router } from "express";
import { CommandAcceptedResponseSchema, SetAutoPauseRequestSchema, SettingsResponseSchema, endpoints } from "@satisfactory-dash/shared";
import type { ServerDirectory } from "../../servers/index.js";
import { resolveServer } from "../../servers/index.js";
import { BadRequestError } from "../../../platform/errorResponse.js";
import { routePath } from "../../../platform/routePath.js";
import { sendValidated } from "../../../platform/sendValidated.js";
import { snapshot } from "../../../platform/snapshot.js";
import type { SettingsScope } from "../settingsServices.js";

/** ADR-0012's settings endpoints. Both sit behind the session guard (ADR-0011). */
export function createSettingsRouter(directory: ServerDirectory<SettingsScope>): Router {
  const router = Router();

  router.get(routePath(endpoints.settings.get.route), async (req, res) => {
    const { serverId, services } = resolveServer(directory, req);
    sendValidated(res, SettingsResponseSchema, snapshot(serverId, await services.settings.getSettings()));
  });

  router.put(routePath(endpoints.settings.setAutoPause.route), async (req, res) => {
    const { serverId, services } = resolveServer(directory, req);
    const body = SetAutoPauseRequestSchema.safeParse(req.body);
    if (!body.success) {
      throw new BadRequestError("Body must be { enabled: boolean }");
    }
    const userId: unknown = res.locals.user?.id;
    const result = await services.settings.setAutoPause(body.data.enabled, { actorUserId: typeof userId === "string" ? userId : undefined });
    // ADR-0031 PR 5b, ADR-0066: always 202 with the command the mod will run (the client follows it with
    // GET /commands/:commandId). ADR-0012's audit line: the command's own audit event records who asked; this line ties
    // the request id to it.
    req.log.info({ audit: "auto-pause", serverId, user: res.locals.user?.name, commandId: result.command.id }, "auto-pause change sent to the agent");
    res.status(202);
    sendValidated(res, CommandAcceptedResponseSchema, result);
  });

  return router;
}
