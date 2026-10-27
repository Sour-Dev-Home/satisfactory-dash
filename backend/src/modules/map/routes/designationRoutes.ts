import express, { Router } from "express";
import { z } from "zod";
import {
  CreatePlannerDesignationRequestSchema,
  DeletePlannerDesignationResponseSchema,
  PlannerDesignationSchema,
  PlannerDesignationsResponseSchema,
  ReplacePlannerDesignationsRequestSchema,
  ReplacePlannerDesignationsResponseSchema,
  UpdatePlannerDesignationRequestSchema,
  endpoints,
} from "@satisfactory-dash/shared";
import type { ServerDirectory } from "../../servers/index.js";
import { resolveServer } from "../../servers/index.js";
import { ApiFailure, BadRequestError, ServerNotFoundError, ServiceUnavailableError, UnauthorizedError } from "../../../platform/errorResponse.js";
import { routePath } from "../../../platform/routePath.js";
import { sendValidated } from "../../../platform/sendValidated.js";
import type { DesignationStore } from "../repositories/designationRepository.js";
import { matchDesignations } from "../services/designationMatching.js";
import type { DesignationBuilding } from "../services/designationMatching.js";

/**
 * The most a designation request body can be: 1000 members of the longest allowed id (128) and class (200) plus
 * coordinates is about 400 KB. The app's own JSON parser (100 KB) skips these writes (app.ts) and this router parses them,
 * so the larger limit applies only here, and only after the session and the member-write guard have run.
 */
export const DESIGNATION_BODY_LIMIT = "512kb";
/** A replace carries at most 2000 members across its `put` entries (ADR-0055 Decision 11): twice the above, so 1 MB. Same
 *  rule: parsed by this router only, after the session and the member-write guard. */
export const DESIGNATION_REPLACE_BODY_LIMIT = "1mb";

export interface DesignationRoutesDeps {
  store: DesignationStore;
  /** The server's buildings from its latest snapshot, or null when there is none yet (or it cannot be read). The composition
   *  root implements it with the telemetry services; map never imports telemetry. */
  buildings: (serverId: string) => Promise<DesignationBuilding[] | null>;
}

const DesignationIdSchema = z.uuid();

/**
 * ADR-0055 Decision 5: Planner designations. Mounted AFTER the servers router (its membership check and member-write guard
 * cover these paths). Without a database there is no table, so every route answers 503.
 */
export function createDesignationRoutes(directory: ServerDirectory<unknown>, deps?: DesignationRoutesDeps): Router {
  const router = Router();
  const parseLarge = express.json({ limit: DESIGNATION_BODY_LIMIT });
  const parseReplace = express.json({ limit: DESIGNATION_REPLACE_BODY_LIMIT });

  const userIdOf = (res: express.Response): string => {
    const id: unknown = res.locals.user?.id;
    if (typeof id !== "string") throw new UnauthorizedError("Sign in to continue");
    return id;
  };
  /** A path id that is not a uuid cannot name a designation: the same 404 as an unknown one. */
  const designationIdOf = (req: express.Request): string => {
    const parsed = DesignationIdSchema.safeParse(req.params.designationId);
    if (!parsed.success) throw new ApiFailure("not_found", "No such designation");
    return parsed.data;
  };
  const parseBody = <S extends z.ZodType>(schema: S, body: unknown): z.output<S> => {
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new BadRequestError("The request body is not valid");
    return parsed.data;
  };

  router.get(routePath(endpoints.plannerDesignations.list.route), async (req, res) => {
    const { serverId } = resolveServer(directory, req);
    if (!deps) throw new ServiceUnavailableError();
    const designations = await deps.store.list(serverId);
    const buildings = designations.length === 0 ? null : await deps.buildings(serverId);
    // `buildingIds` is the reduction's; the API gets the same ids aligned to members (Decision 12), for splitting.
    const matches = matchDesignations(designations, buildings).map(({ buildingIds: _kept, ...match }) => match);
    sendValidated(res, PlannerDesignationsResponseSchema, { designations, matches });
  });

  router.post(routePath(endpoints.plannerDesignations.create.route), parseLarge, async (req, res) => {
    const { serverId } = resolveServer(directory, req);
    if (!deps) throw new ServiceUnavailableError();
    const body = parseBody(CreatePlannerDesignationRequestSchema, req.body);
    const outcome = await deps.store.create(serverId, { userId: userIdOf(res), name: body.name, mode: body.mode, members: body.members });
    if (outcome.kind === "no_server") throw new ServerNotFoundError();
    if (outcome.kind === "cap") throw new ApiFailure("designation_cap", "This server already has the most designations allowed");
    if (outcome.kind === "overlap") {
      throw new ApiFailure("designation_overlap", "A building is already in another designation", undefined, undefined, outcome.other);
    }
    res.status(201);
    sendValidated(res, PlannerDesignationSchema, outcome.designation);
  });

  // Registered before PUT/DELETE .../:designationId for clarity; they never collide (POST is only this and the create).
  router.post(routePath(endpoints.plannerDesignations.replace.route), parseReplace, async (req, res) => {
    const { serverId } = resolveServer(directory, req);
    if (!deps) throw new ServiceUnavailableError();
    const body = parseBody(ReplacePlannerDesignationsRequestSchema, req.body);
    const outcome = await deps.store.replace(serverId, {
      userId: userIdOf(res),
      expect: body.expect,
      put: body.put,
      ...(body.intent !== undefined && { intent: body.intent }),
    });
    if (outcome.kind === "no_server") throw new ServerNotFoundError();
    if (outcome.kind === "created_in_future") throw new BadRequestError("A creation time is in the future");
    if (outcome.kind === "stale") throw new ApiFailure("designation_stale", "One of these designations was changed by someone else");
    if (outcome.kind === "cap") throw new ApiFailure("designation_cap", "The result would have more designations than allowed");
    if (outcome.kind === "overlap") {
      throw new ApiFailure("designation_overlap", "A building is already in another designation", undefined, undefined, outcome.other);
    }
    sendValidated(res, ReplacePlannerDesignationsResponseSchema, { designations: outcome.designations, removedIds: outcome.removedIds });
  });

  router.put(routePath(endpoints.plannerDesignations.update.route), parseLarge, async (req, res) => {
    const { serverId } = resolveServer(directory, req);
    if (!deps) throw new ServiceUnavailableError();
    const designationId = designationIdOf(req);
    const body = parseBody(UpdatePlannerDesignationRequestSchema, req.body);
    const outcome = await deps.store.update(serverId, designationId, {
      userId: userIdOf(res),
      ...(body.name !== undefined && { name: body.name }),
      ...(body.members !== undefined && { members: body.members }),
    });
    if (outcome.kind === "no_server") throw new ServerNotFoundError();
    if (outcome.kind === "not_found") throw new ApiFailure("not_found", "No such designation");
    if (outcome.kind === "overlap") {
      throw new ApiFailure("designation_overlap", "A building is already in another designation", undefined, undefined, outcome.other);
    }
    sendValidated(res, PlannerDesignationSchema, outcome.designation);
  });

  router.delete(routePath(endpoints.plannerDesignations.remove.route), async (req, res) => {
    const { serverId } = resolveServer(directory, req);
    if (!deps) throw new ServiceUnavailableError();
    const designationId = designationIdOf(req);
    if (!(await deps.store.remove(serverId, designationId, userIdOf(res)))) throw new ApiFailure("not_found", "No such designation");
    sendValidated(res, DeletePlannerDesignationResponseSchema, { deleted: true });
  });

  return router;
}
