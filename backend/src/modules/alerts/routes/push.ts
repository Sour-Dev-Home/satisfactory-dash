import { Router } from "express";
import type { Request, Response } from "express";
import {
  PushConfigResponseSchema,
  PushOptInRequestSchema,
  PushOptInResponseSchema,
  PushSubscribeRequestSchema,
  PushSubscribeResponseSchema,
  PushTestResponseSchema,
  PushUnsubscribeResponseSchema,
  ServerIdSchema,
  endpoints,
} from "@satisfactory-dash/shared";
import { BadRequestError, InvalidServerIdError, UnauthorizedError } from "../../../platform/errorResponse.js";
import { routePath } from "../../../platform/routePath.js";
import { sendValidated } from "../../../platform/sendValidated.js";
import type { PushService } from "../services/pushService.js";

/**
 * ADR-0044 (#348): the web push API. Mounted under /api behind the session guard, AFTER the servers router (whose
 * membership check covers `/servers/:serverId/alerts/push`, and which lets any member, a viewer included, make this one
 * write). Every handler acts on the SIGNED-IN user only: no route takes a user id, so there is nothing to swap.
 *
 * The subscription's endpoint and keys exist only in the body of `POST /push/subscriptions`. A body that fails its schema
 * is answered with a FIXED message (never the schema's issues, which can quote input), and nothing here logs a body.
 */
export function createPushRouter(service: PushService): Router {
  const router = Router();

  const actorOf = (res: Response): string => {
    const id: unknown = res.locals.user?.id;
    if (typeof id !== "string") throw new UnauthorizedError("Sign in to continue");
    return id;
  };
  const serverIdOf = (req: Request): string => {
    const parsed = ServerIdSchema.safeParse(req.params.serverId);
    if (!parsed.success) throw new InvalidServerIdError();
    return parsed.data;
  };
  const subscriptionIdOf = (req: Request): string => (typeof req.params.id === "string" ? req.params.id : "");

  router.get(routePath(endpoints.push.config.route), (_req, res) => {
    sendValidated(res, PushConfigResponseSchema, service.config());
  });

  router.post(routePath(endpoints.push.subscribe.route), async (req, res) => {
    const userId = actorOf(res);
    const body = PushSubscribeRequestSchema.safeParse(req.body);
    if (!body.success) throw new BadRequestError("The request body is not valid");
    const { created, subscription } = await service.subscribe(userId, body.data);
    res.status(created ? 201 : 200);
    sendValidated(res, PushSubscribeResponseSchema, subscription);
  });

  router.delete(routePath(endpoints.push.unsubscribe.route), async (req, res) => {
    sendValidated(res, PushUnsubscribeResponseSchema, await service.unsubscribe(actorOf(res), subscriptionIdOf(req)));
  });

  router.post(routePath(endpoints.push.test.route), async (req, res) => {
    sendValidated(res, PushTestResponseSchema, await service.test(actorOf(res), subscriptionIdOf(req)));
  });

  router.get(routePath(endpoints.push.optIn.get.route), async (req, res) => {
    sendValidated(res, PushOptInResponseSchema, await service.getOptIn(serverIdOf(req), actorOf(res)));
  });

  router.put(routePath(endpoints.push.optIn.put.route), async (req, res) => {
    const serverId = serverIdOf(req);
    const body = PushOptInRequestSchema.safeParse(req.body);
    if (!body.success) throw new BadRequestError("The request body is not valid");
    sendValidated(res, PushOptInResponseSchema, await service.setOptIn(serverId, actorOf(res), body.data.optedIn));
  });

  return router;
}
