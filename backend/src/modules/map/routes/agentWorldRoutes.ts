import express, { Router } from "express";
import type { RequestHandler } from "express";
import { IsoTimeSchema, KNOWN_MAP_WORLD_LAYERS, MAP_WORLD_LAYER_MAX_BYTES, WorldIngestResponseSchema, endpoints } from "@satisfactory-dash/shared";
import type { MapWorldLayer } from "@satisfactory-dash/shared";
import { BadRequestError, RateLimitedError } from "../../../platform/errorResponse.js";
import { requireJsonBody } from "../../../platform/httpPolicy.js";
import { sendValidated } from "../../../platform/sendValidated.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import type { WorldIngestPort } from "../services/worldIngestService.js";

/** The agent API is mounted at /agent/v1, not under /api (agentApi.ts's own convention). */
const agentRoutePath = (route: string): string => route.replace(/^\/agent\/v1(?=\/)/, "");

const isKnownLayer = (layer: string): layer is MapWorldLayer => (KNOWN_MAP_WORLD_LAYERS as readonly string[]).includes(layer);

export interface AgentWorldRoutesDeps {
  /** Authenticates `Authorization: Bearer <secret>` and sets `res.locals.agent` (agents'
   *  services/agentAuth.ts) — injected, not imported: `map` has no edge to `agents`. */
  auth: RequestHandler;
  ingest: WorldIngestPort;
  /** Tests only: the decompressed size cap (default MAP_WORLD_LAYER_MAX_BYTES). */
  worldLayerMaxBytes?: number;
  /** Per credential, across every layer; default 20 per 10 minutes (architect, PR #374 review) —
   *  generous against the real cadence (a send every 10-30 min per layer), but a valid credential
   *  looping POSTs of up to 2 MB, each a potential 2 MB jsonb upsert, must not go unbounded. */
  worldRateLimiter?: UserRateLimiter;
}

interface AgentIdentity {
  serverUuid: string;
  publicId: string;
}

/**
 * ADR-0038 M3 (#353): POST /agent/v1/world/:layer, the edge agent's (M4) and — via the SAME body
 * shape — a local-server poller's own path into the same `WorldIngestService`. Gzip-able; the
 * DECOMPRESSED size is capped at MAP_WORLD_LAYER_MAX_BYTES (body-parser answers 413, never a
 * truncate: an over-BYTE body is a different problem than an over-ITEM-COUNT one, which the ingest
 * service truncates instead of rejecting). A body that fails its basic shape is a fixed 400 message,
 * never the schema's issues (agentApi.ts's own convention: nothing here echoes untrusted input).
 */
export function createAgentWorldRouter(deps: AgentWorldRoutesDeps): Router {
  const router = Router();
  const worldRateLimiter = deps.worldRateLimiter ?? new UserRateLimiter({ max: 20, windowMs: 10 * 60_000 });
  const worldRateLimit: RequestHandler = (_req, res, next) => {
    const agent = res.locals.agent as AgentIdentity;
    const wait = worldRateLimiter.hit(agent.serverUuid);
    if (wait > 0) throw new RateLimitedError(wait, "Too many world-layer ingests. Slow down.");
    next();
  };
  router.post(
    agentRoutePath(endpoints.agentApi.world.route),
    deps.auth,
    worldRateLimit,
    requireJsonBody,
    express.json({ limit: deps.worldLayerMaxBytes ?? MAP_WORLD_LAYER_MAX_BYTES, inflate: true }),
    async (req, res) => {
      const agent = res.locals.agent as AgentIdentity;
      const layer = typeof req.params.layer === "string" ? req.params.layer : "";
      if (!isKnownLayer(layer)) throw new BadRequestError("Unknown map layer");
      const body = req.body as unknown;
      if (
        typeof body !== "object" ||
        body === null ||
        // Format, not just typeof "string" (test-hunter, PR #374): a non-ISO value must not reach
        // the database as an invalid ::timestamptz cast, which would fail the WHOLE ingest instead
        // of a clean 400 — the opposite of this module's own conform-don't-reject rule.
        !IsoTimeSchema.safeParse((body as { observedAt?: unknown }).observedAt).success ||
        !Array.isArray((body as { data?: unknown }).data)
      ) {
        throw new BadRequestError("The request body is not valid");
      }
      const result = await deps.ingest.ingest(agent.publicId, layer, { observedAt: (body as { observedAt: string }).observedAt, data: (body as { data: unknown[] }).data });
      sendValidated(res, WorldIngestResponseSchema, result);
    },
  );
  return router;
}
