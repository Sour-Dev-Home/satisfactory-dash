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
    const who = { audit: "auto-pause", serverId, user: res.locals.user?.name };
    const userId: unknown = res.locals.user?.id;
    const result = await services.settings.setAutoPause(
      body.data.enabled,
      ({ from, to, confirmedByReread }) => {
        // ADR-0012: one audit line per change, written as soon as the write succeeds.
        // req.log is bound to the request id (ADR-0008); the user comes from the session guard.
        // When the write's response was lost (a timeout or a dropped connection) and a re-read
        // showed the requested value, the line must not claim a change it can't know about: the
        // write may have landed, or the option may already have held that value (or someone else
        // set it). So it records what was asked and what was observed, plus the value read just
        // before the write, and no from -> to.
        if (confirmedByReread) {
          req.log.info(
            { ...who, requested: to, observed: to, previous: from, outcome: "confirmed by re-read" },
            "auto-pause write response lost; a re-read observed the requested value (outcome confirmed by re-read)",
          );
        } else {
          req.log.info({ ...who, from, to }, "auto-pause changed");
        }
      },
      { actorUserId: typeof userId === "string" ? userId : undefined },
    );
    // ADR-0031 PR 5b: a server reached through an edge agent answers 202 with the command the agent will run (the client
    // follows it with GET /commands/:commandId); a `local` server answers 200 with the new setting, as before.
    if ("command" in result) {
      req.log.info({ ...who, commandId: result.command.id }, "auto-pause change sent to the agent");
      res.status(202);
      sendValidated(res, CommandAcceptedResponseSchema, result);
      return;
    }
    sendValidated(res, SettingsResponseSchema, snapshot(serverId, result));
  });

  return router;
}
