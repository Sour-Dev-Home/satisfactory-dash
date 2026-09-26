import { Router } from "express";
import type { Request, Response } from "express";
import {
  AgentStatusResponseSchema,
  CommandResponseSchema,
  EnrollmentCodeResponseSchema,
  RevokeAgentResponseSchema,
  ServerIdSchema,
  endpoints,
} from "@satisfactory-dash/shared";
import { InvalidServerIdError, UnauthorizedError } from "../../../platform/errorResponse.js";
import { routePath } from "../../../platform/routePath.js";
import { sendValidated } from "../../../platform/sendValidated.js";
import type { AgentsService } from "../services/agentsService.js";
import type { CommandsService } from "../services/commandsService.js";

/**
 * ADR-0031 PR 5a: the user-facing agent routes, under /api/servers/:serverId. Mounted AFTER the servers router, whose
 * membership check runs on every `/servers/:serverId/...` path first (a non-member gets the same 404 as an unknown
 * server; a viewer's write is a 403), so these handlers only ever see a member, an owner or admin for every write.
 * The enrolment code is a secret: it is in the body of one response and nowhere else (not in a log, not in an audit event).
 */
export function createAgentUserRouter(service: AgentsService, commands: Pick<CommandsService, "getCommand">): Router {
  const router = Router();

  const serverIdOf = (req: Request): string => {
    const parsed = ServerIdSchema.safeParse(req.params.serverId);
    if (!parsed.success) throw new InvalidServerIdError();
    return parsed.data;
  };
  const actorOf = (res: Response): string => {
    const id: unknown = res.locals.user?.id;
    if (typeof id !== "string") throw new UnauthorizedError("Sign in to continue");
    return id;
  };

  router.post(routePath(endpoints.agent.enrollmentCode.route), async (req, res) => {
    const created = await service.createEnrollmentCode(serverIdOf(req), actorOf(res));
    res.status(201);
    sendValidated(res, EnrollmentCodeResponseSchema, created);
  });
  router.get(routePath(endpoints.agent.status.route), async (req, res) => {
    sendValidated(res, AgentStatusResponseSchema, await service.getStatus(serverIdOf(req)));
  });
  router.delete(routePath(endpoints.agent.revoke.route), async (req, res) => {
    sendValidated(res, RevokeAgentResponseSchema, await service.revoke(serverIdOf(req), actorOf(res)));
  });

  // ADR-0031 PR 5b: where a command stands (the auto-pause PUT answered 202 with one). Any member may read it, and only
  // one of THIS server's: another server's command id is the same command_not_found as an unknown one.
  router.get(routePath(endpoints.commands.get.route), async (req, res) => {
    const commandId = typeof req.params.commandId === "string" ? req.params.commandId : "";
    sendValidated(res, CommandResponseSchema, { command: await commands.getCommand(serverIdOf(req), commandId) });
  });

  return router;
}
