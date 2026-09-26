import express, { Router } from "express";
import type { RequestHandler, Response } from "express";
import {
  AgentCommandsQuerySchema,
  AgentCommandsResponseSchema,
  CommandIdSchema,
  CommandResultRequestSchema,
  CommandResultResponseSchema,
  EnrollRequestSchema,
  EnrollResponseSchema,
  SnapshotRequestSchema,
  SnapshotResponseSchema,
  endpoints,
} from "@satisfactory-dash/shared";
import type { Cadence } from "@satisfactory-dash/shared";
import { BadRequestError, RateLimitedError, ServiceUnavailableError } from "../../../platform/errorResponse.js";
import { requireJsonBody } from "../../../platform/httpPolicy.js";
import { sendValidated } from "../../../platform/sendValidated.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import type { ServerDirectory } from "../../servers/index.js";
import type { TelemetryScope } from "../../telemetry/index.js";
import { SNAPSHOT_MAX_BYTES } from "../config.js";
import type { AgentIdentity } from "../services/agentAuth.js";
import { rateLimitKey } from "../services/clientKey.js";
import type { AgentCommandsService } from "../services/commandsService.js";
import type { EnrollmentService } from "../services/enrollmentService.js";

/** The agent API is mounted at /agent/v1 (not under /api): a shared route pattern is registered without that prefix. */
export const agentRoutePath = (route: string): string => route.replace(/^\/agent\/v1(?=\/)/, "");

export interface AgentApiDeps {
  /** Authenticates `Authorization: Bearer <secret>` and sets `res.locals.agent` (services/agentAuth.ts). */
  auth: RequestHandler;
  enrollment: EnrollmentService;
  /** ADR-0031 PR 5b: the command long-poll, the result report and the snapshot answer's `commandsPending`. */
  commands: AgentCommandsService;
  directory: ServerDirectory<TelemetryScope>;
  /** Builds the agent-backed running entry for a server that has none yet (idempotent). */
  attachAgentRuntime: (publicId: string) => Promise<void>;
  /** Records a changed agent version for the status route (best effort). */
  recordVersion: (serverUuid: string, agentVersion: string) => Promise<void>;
  cadence: () => Cadence;
  /** False until the database servers are loaded: snapshots are answered 503 (the agent retries) rather than dropped. */
  isReady?: () => boolean;
  /** Tests only: the decompressed size cap (default 5 MB). */
  snapshotMaxBytes?: number;
  /** Per client address; default 10 enrolment attempts a minute. */
  enrollLimiter?: UserRateLimiter;
  /** Across every caller; default 120 enrolment attempts a minute for the whole process. */
  globalEnrollLimiter?: UserRateLimiter;
  /** Per server (credential); default 50 snapshots per 10 seconds: about 5 a second, bursts allowed. */
  snapshotLimiter?: UserRateLimiter;
  now?: () => number;
}

/**
 * ADR-0031 PR 5a: the agent's own API. It sits OUTSIDE /api (no session, no cookies, no CORS, no cross-site guard: an
 * agent is not a browser); `enroll` is authenticated by the one-time code, everything else by the agent's credential.
 *
 * Bodies: a snapshot may be gzip-compressed (`Content-Encoding: gzip`) and its DECOMPRESSED size is capped, so a
 * compression bomb is refused with 413 `payload_too_large` (body-parser measures the inflated stream). A body that fails
 * its schema is answered with a FIXED message (never the schema's issues, which quote input), and nothing here logs a
 * body: a snapshot holds player names (ADR-0029).
 */
export function createAgentApiRouter(deps: AgentApiDeps): Router {
  const router = Router();
  const now = deps.now ?? Date.now;
  const enrollLimiter = deps.enrollLimiter ?? new UserRateLimiter({ max: 10, windowMs: 60_000 });
  const globalEnrollLimiter = deps.globalEnrollLimiter ?? new UserRateLimiter({ max: 120, windowMs: 60_000 });
  const snapshotLimiter = deps.snapshotLimiter ?? new UserRateLimiter({ max: 50, windowMs: 10_000 });
  const versions = new Map<string, string>();

  router.post(
    agentRoutePath(endpoints.agentApi.enroll.route),
    requireJsonBody,
    express.json({ limit: "4kb" }),
    async (req, res) => {
      // Per network (an IPv6 /64 counts as one) AND process-wide: the per-network table is bounded, so a flood of distinct
      // addresses could push counters out, and every open code on every server is a target for a guess.
      const wait = Math.max(enrollLimiter.hit(rateLimitKey(req)), globalEnrollLimiter.hit("all"));
      if (wait > 0) throw new RateLimitedError(wait, "Too many enrollment attempts. Try again in a minute.");
      const body = EnrollRequestSchema.safeParse(req.body);
      if (!body.success) throw new BadRequestError("The request body is not valid");
      const enrolled = await deps.enrollment.enroll(body.data.code, body.data.agentVersion);
      res.status(201);
      sendValidated(res, EnrollResponseSchema, enrolled);
    },
  );

  const snapshotRateLimit: RequestHandler = (_req, res, next) => {
    const agent = res.locals.agent as AgentIdentity;
    const wait = snapshotLimiter.hit(agent.serverUuid);
    if (wait > 0) throw new RateLimitedError(wait, "Too many snapshots. Slow down.");
    next();
  };

  router.post(
    agentRoutePath(endpoints.agentApi.snapshots.route),
    deps.auth,
    snapshotRateLimit,
    requireJsonBody,
    express.json({ limit: deps.snapshotMaxBytes ?? SNAPSHOT_MAX_BYTES, inflate: true }),
    async (req, res: Response) => {
      const agent = res.locals.agent as AgentIdentity;
      const snapshot = SnapshotRequestSchema.safeParse(req.body);
      if (!snapshot.success) throw new BadRequestError("The snapshot is not valid");
      if (deps.isReady && !deps.isReady()) throw new ServiceUnavailableError();
      let ingest = deps.directory.get(agent.publicId)?.telemetry.agentIngest;
      if (ingest === undefined) {
        // A valid credential whose server has no agent-backed entry yet (the swap after enrolment failed, or this
        // process restarted): build it now, once. Never for a server that is not there at all.
        await deps.attachAgentRuntime(agent.publicId).catch(() => undefined);
        ingest = deps.directory.get(agent.publicId)?.telemetry.agentIngest;
      }
      if (ingest === undefined) throw new ServiceUnavailableError();
      ingest.ingest(snapshot.data, now());
      if (versions.get(agent.serverUuid) !== snapshot.data.agentVersion) {
        versions.set(agent.serverUuid, snapshot.data.agentVersion);
        void deps.recordVersion(agent.serverUuid, snapshot.data.agentVersion).catch(() => versions.delete(agent.serverUuid));
      }
      // `commandsPending` tells the agent to call GET /commands now (a hint: its long-poll would find the command too).
      sendValidated(res, SnapshotResponseSchema, { cadence: deps.cadence(), commandsPending: await deps.commands.hasPending(agent.serverUuid) });
    },
  );

  // GET /commands?waitSeconds=0..25: the agent's long-poll. Answered as soon as a command exists for its server, or empty
  // when the wait is up (the agent asks again). The wait ends early if the agent hangs up.
  router.get(agentRoutePath(endpoints.agentApi.commands.route), deps.auth, snapshotRateLimit, async (req, res) => {
    const agent = res.locals.agent as AgentIdentity;
    const query = AgentCommandsQuerySchema.safeParse(req.query);
    if (!query.success) throw new BadRequestError("The query is not valid");
    const hangUp = new AbortController();
    res.on("close", () => hangUp.abort());
    const commands = await deps.commands.poll(agent, query.data.waitSeconds, hangUp.signal);
    if (hangUp.signal.aborted) return; // nobody is listening
    sendValidated(res, AgentCommandsResponseSchema, { commands });
  });

  // POST /commands/:commandId/result: the agent reports what happened, as a CODE (never free text). Only for a command of
  // ITS OWN server; unknown and other servers' ids are the same 404, an expired one a 409.
  router.post(
    agentRoutePath(endpoints.agentApi.result.route),
    deps.auth,
    snapshotRateLimit,
    requireJsonBody,
    express.json({ limit: "4kb" }),
    async (req, res) => {
      const agent = res.locals.agent as AgentIdentity;
      const commandId = typeof req.params.commandId === "string" ? req.params.commandId : "";
      if (!CommandIdSchema.safeParse(commandId).success) throw new BadRequestError("The command id is not valid");
      const result = CommandResultRequestSchema.safeParse(req.body);
      if (!result.success) throw new BadRequestError("The result is not valid");
      await deps.commands.report(agent, commandId, result.data);
      sendValidated(res, CommandResultResponseSchema, { accepted: true });
    },
  );

  return router;
}
