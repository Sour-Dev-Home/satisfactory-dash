import { Router } from "express";
import { SetAutoPauseRequestSchema, SettingsResponseSchema, endpoints } from "@satisfactory-dash/shared";
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
    const settings = await services.settings.setAutoPause(body.data.enabled, ({ from, to }) => {
      // ADR-0012: one audit line per change, written as soon as the write succeeds.
      // req.log is bound to the request id (ADR-0008); the user comes from the session guard.
      req.log.info({ audit: "auto-pause", serverId, user: res.locals.user?.name, from, to }, "auto-pause changed");
    });
    sendValidated(res, SettingsResponseSchema, snapshot(serverId, settings));
  });

  return router;
}
