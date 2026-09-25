import { Router } from "express";
import { ServerPlayersResponseSchema, endpoints } from "@satisfactory-dash/shared";
import type { ServerDirectory } from "../../servers/index.js";
import { resolveServer } from "../../servers/index.js";
import { routePath } from "../../../platform/routePath.js";
import { sendValidated } from "../../../platform/sendValidated.js";
import type { TelemetryScope } from "../telemetryServices.js";

/** ADR-0029. Members only by construction: the /api/servers/:serverId authorization (ADR-0025 PR 6)
 *  runs before this route. The names are only ever in the response body, never logged. */
export function createPlayersRouter(directory: ServerDirectory<TelemetryScope>): Router {
  const router = Router();
  router.get(routePath(endpoints.players.route), async (req, res) => {
    const { services } = resolveServer(directory, req);
    sendValidated(res, ServerPlayersResponseSchema, await services.telemetry.players.getPlayers());
  });
  return router;
}
