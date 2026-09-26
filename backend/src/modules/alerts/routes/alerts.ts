import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  AlertDestinationsResponseSchema,
  AlertEventsQuerySchema,
  AlertEventsResponseSchema,
  AlertRuleResponseSchema,
  AlertRulesResponseSchema,
  AlertStatusResponseSchema,
  CreateAlertRuleRequestSchema,
  DeleteAlertRuleResponseSchema,
  DeleteDestinationResponseSchema,
  DiscordDestinationResponseSchema,
  MuteClearedResponseSchema,
  MuteSetResponseSchema,
  PatchDiscordDestinationRequestSchema,
  PutDiscordDestinationRequestSchema,
  SendTestResponseSchema,
  ServerIdSchema,
  SetMuteRequestSchema,
  UpdateAlertRuleRequestSchema,
  endpoints,
} from "@satisfactory-dash/shared";
import { BadRequestError, InvalidServerIdError, UnauthorizedError } from "../../../platform/errorResponse.js";
import { routePath } from "../../../platform/routePath.js";
import { sendValidated } from "../../../platform/sendValidated.js";
import type { AlertsService } from "../services/alertsService.js";

/**
 * ADR-0027 PR 7b: the alerts API. Mounted AFTER the servers router, whose membership check runs on every
 * `/servers/:serverId/...` path first (a non-member gets the same 404 as an unknown server; a viewer's write is a 403), so
 * these handlers only ever see a member of the server, an owner or admin for every write.
 *
 * The webhook URL is a secret and exists only in the body of `PUT .../destinations/discord`. A body that fails its schema
 * is answered with a FIXED message (never the schema's issues, which can quote input), and nothing here logs a body.
 */
export function createAlertsRouter(service: AlertsService): Router {
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
  const bodyOf = <S extends z.ZodType>(schema: S, req: Request): z.output<S> => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError("The request body is not valid");
    return parsed.data;
  };
  const ruleIdOf = (req: Request): string => (typeof req.params.ruleId === "string" ? req.params.ruleId : "");

  // Rules
  router.get(routePath(endpoints.alerts.rules.list.route), async (req, res) => {
    sendValidated(res, AlertRulesResponseSchema, await service.listRules(serverIdOf(req)));
  });
  router.post(routePath(endpoints.alerts.rules.create.route), async (req, res) => {
    const serverId = serverIdOf(req);
    const body = bodyOf(CreateAlertRuleRequestSchema, req);
    const created = await service.createRule(serverId, actorOf(res), body);
    res.status(201);
    sendValidated(res, AlertRuleResponseSchema, created);
  });
  router.patch(routePath(endpoints.alerts.rules.update.route), async (req, res) => {
    const serverId = serverIdOf(req);
    const body = bodyOf(UpdateAlertRuleRequestSchema, req);
    sendValidated(res, AlertRuleResponseSchema, await service.updateRule(serverId, actorOf(res), ruleIdOf(req), body));
  });
  router.delete(routePath(endpoints.alerts.rules.remove.route), async (req, res) => {
    sendValidated(res, DeleteAlertRuleResponseSchema, await service.deleteRule(serverIdOf(req), actorOf(res), ruleIdOf(req)));
  });

  // The Discord destination
  router.get(routePath(endpoints.alerts.destinations.get.route), async (req, res) => {
    sendValidated(res, AlertDestinationsResponseSchema, await service.getDestinations(serverIdOf(req)));
  });
  router.put(routePath(endpoints.alerts.destinations.putDiscord.route), async (req, res) => {
    const serverId = serverIdOf(req);
    const body = bodyOf(PutDiscordDestinationRequestSchema, req);
    sendValidated(res, DiscordDestinationResponseSchema, await service.putDiscord(serverId, actorOf(res), body.webhookUrl));
  });
  router.patch(routePath(endpoints.alerts.destinations.patchDiscord.route), async (req, res) => {
    const serverId = serverIdOf(req);
    const body = bodyOf(PatchDiscordDestinationRequestSchema, req);
    sendValidated(res, DiscordDestinationResponseSchema, await service.patchDiscord(serverId, actorOf(res), body.enabled));
  });
  router.delete(routePath(endpoints.alerts.destinations.removeDiscord.route), async (req, res) => {
    sendValidated(res, DeleteDestinationResponseSchema, await service.removeDiscord(serverIdOf(req), actorOf(res)));
  });
  router.post(routePath(endpoints.alerts.destinations.testDiscord.route), async (req, res) => {
    sendValidated(res, SendTestResponseSchema, await service.testDiscord(serverIdOf(req), actorOf(res)));
  });

  // The alert log, status and mute
  router.get(routePath(endpoints.alerts.events.route), async (req, res) => {
    const serverId = serverIdOf(req);
    const query = AlertEventsQuerySchema.safeParse(req.query);
    if (!query.success) throw new BadRequestError("The query is not valid");
    sendValidated(res, AlertEventsResponseSchema, await service.listEvents(serverId, query.data));
  });
  router.get(routePath(endpoints.alerts.status.route), async (req, res) => {
    sendValidated(res, AlertStatusResponseSchema, await service.getStatus(serverIdOf(req)));
  });
  router.put(routePath(endpoints.alerts.mute.set.route), async (req, res) => {
    const serverId = serverIdOf(req);
    const body = bodyOf(SetMuteRequestSchema, req);
    sendValidated(res, MuteSetResponseSchema, await service.setMute(serverId, actorOf(res), body.until));
  });
  router.delete(routePath(endpoints.alerts.mute.clear.route), async (req, res) => {
    sendValidated(res, MuteClearedResponseSchema, await service.clearMute(serverIdOf(req), actorOf(res)));
  });

  return router;
}
