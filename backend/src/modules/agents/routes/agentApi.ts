import type { IncomingMessage, ServerResponse } from "node:http";
import express, { Router } from "express";
import type { ErrorRequestHandler, Request, RequestHandler, Response } from "express";
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
import type { Logger } from "pino";
import { BadRequestError, RateLimitedError, ServiceUnavailableError } from "../../../platform/errorResponse.js";
import { createLogger } from "../../../platform/logger.js";
import { AGENT_REFUSED_STATUSES, createBackgroundRecorder, type MetricsSink } from "../../../platform/metrics/index.js";
import { requireJsonBody } from "../../../platform/httpPolicy.js";
import { sendValidated } from "../../../platform/sendValidated.js";
import { TokenBucketLimiter } from "../../../platform/tokenBucket.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import type { ServerDirectory } from "../../servers/index.js";
import type { TelemetryScope } from "../../telemetry/index.js";
import { COMMANDS_RATE, SNAPSHOT_BYTE_BUDGET, SNAPSHOT_MAX_BYTES, SNAPSHOT_RATE } from "../config.js";
import type { AgentIdentity } from "../services/agentAuth.js";
import { rateLimitKey } from "../services/clientKey.js";
import type { AgentCommandsService } from "../services/commandsService.js";
import type { EnrollmentService } from "../services/enrollmentService.js";

/** The statuses `satis.agent.refused` counts (#514): a malformed request, a bad credential, an oversized or wrongly typed
 *  body, a rate limit. */
const REFUSED_STATUSES: ReadonlySet<string> = new Set(AGENT_REFUSED_STATUSES);

/** body-parser's error types for checks it makes before reading any of the body. */
const BODY_CHECKS_BEFORE_READING: ReadonlySet<string> = new Set(["charset.unsupported", "encoding.unsupported", "stream.encoding.set", "stream.not.readable"]);

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
  /** Snapshots per credential (#514); default `SNAPSHOT_RATE` (config.ts). */
  snapshotLimiter?: TokenBucketLimiter;
  /** Decompressed snapshot bytes per credential (#514); default `SNAPSHOT_BYTE_BUDGET`. */
  snapshotByteBudget?: TokenBucketLimiter;
  /** Command polls and results per credential (#514); default `COMMANDS_RATE`. */
  commandsLimiter?: TokenBucketLimiter;
  now?: () => number;
  /** Where a metrics failure is logged (once); default a logger of its own. */
  logger?: Logger;
  /** Tests only: where the metrics go (default the process-wide background aggregator). */
  metrics?: MetricsSink;
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
  const snapshotLimiter = deps.snapshotLimiter ?? new TokenBucketLimiter({ ...SNAPSHOT_RATE, now });
  const snapshotByteBudget = deps.snapshotByteBudget ?? new TokenBucketLimiter({ ...SNAPSHOT_BYTE_BUDGET, now });
  const commandsLimiter = deps.commandsLimiter ?? new TokenBucketLimiter({ ...COMMANDS_RATE, now });
  const versions = new Map<string, string>();
  /** The open long-poll of each credential (#514): a new one ends the old one, so a credential holds at most one. */
  const openPolls = new Map<string, AbortController>();
  /** Credentials with a snapshot upload in flight (#514): at most one each. */
  const uploading = new Set<string>();
  const metrics = createBackgroundRecorder(deps.logger ?? createLogger(), deps.metrics);

  // #514 (ADR-0045 O4): every refused agent request is counted by server public id ("unknown" before authentication), so
  // the operator can see which server misbehaves. Registered first, it also sees the routers mounted after this one at
  // /agent/v1 (map's world-layer route). It reads only the final status and the identity auth set: never a body or header.
  router.use((_req, res, next) => {
    res.on("finish", () => {
      const status = String(res.statusCode);
      if (!REFUSED_STATUSES.has(status)) return;
      const agent = res.locals.agent as AgentIdentity | undefined;
      metrics.counter("satis.agent.refused", { server: agent?.publicId ?? "unknown", status });
    });
    next();
  });

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

  // Both checked before the body is read: a refused snapshot is never inflated or parsed. The rate is spent here; the
  // bytes are charged once the body is inflated (express.json's `verify` runs before JSON.parse), and a credential whose
  // byte budget is in debt is refused here until it is repaid.
  //
  // One snapshot upload in flight per credential (#514 security review): `admit` checks the balance only at the start, so
  // without this, many concurrent uploads of a positive-balance credential would all be read and parsed at once. The
  // agent sends one at a time (agent/src/pusher.ts awaits each post before the next), so it never waits on this.
  const snapshotRateLimit: RequestHandler = (_req, res, next) => {
    const agent = res.locals.agent as AgentIdentity;
    if (uploading.has(agent.serverUuid)) throw new RateLimitedError(1, "A snapshot upload is already in progress. Slow down.");
    const bytesWait = snapshotByteBudget.admit(agent.serverUuid);
    if (bytesWait > 0) throw new RateLimitedError(bytesWait, "Too many snapshot bytes. Slow down.");
    const wait = snapshotLimiter.take(agent.serverUuid);
    if (wait > 0) throw new RateLimitedError(wait, "Too many snapshots. Slow down.");
    uploading.add(agent.serverUuid);
    // `close` fires once the response is sent or the connection drops: the body has been read and handled, or never will be.
    res.on("close", () => uploading.delete(agent.serverUuid));
    next();
  };
  /** Marks that the body is about to be read, so a body-parser error after this point is charged (below). */
  const bodyReading: RequestHandler = (_req, res, next) => {
    res.locals.bodyReading = true;
    next();
  };
  const snapshotMaxBytes = deps.snapshotMaxBytes ?? SNAPSHOT_MAX_BYTES;
  const chargeSnapshotBytes = (_req: IncomingMessage, res: ServerResponse, body: Buffer): void => {
    (res as Response).locals.bytesCharged = true;
    snapshotByteBudget.charge(((res as Response).locals.agent as AgentIdentity).serverUuid, body.length);
  };
  // A body that failed while it was being read was charged nothing by `verify`, yet may have been inflated almost to the
  // cap: over the cap (413), a truncated or corrupt gzip stream (400), a client that hung up midway (request.aborted).
  // Each is charged the cap, so failing uploads spend the same budget as real ones. Only body-parser's checks made
  // before any byte is read (an unsupported charset or encoding) are not, and neither is a failure before `bodyReading`
  // (a wrong content type) or after `verify` (bad JSON, already charged its real size).
  const chargeFailedSnapshotBody: ErrorRequestHandler = (err: unknown, _req, res, next) => {
    const type = (err as { type?: unknown } | null)?.type;
    const beforeReading = typeof type === "string" && BODY_CHECKS_BEFORE_READING.has(type);
    if (res.locals.bodyReading === true && res.locals.bytesCharged !== true && !beforeReading) {
      snapshotByteBudget.charge((res.locals.agent as AgentIdentity).serverUuid, snapshotMaxBytes);
    }
    next(err);
  };
  const commandsRateLimit: RequestHandler = (_req, res, next) => {
    const wait = commandsLimiter.take((res.locals.agent as AgentIdentity).serverUuid);
    if (wait > 0) throw new RateLimitedError(wait, "Too many command requests. Slow down.");
    next();
  };

  router.post(
    agentRoutePath(endpoints.agentApi.snapshots.route),
    deps.auth,
    snapshotRateLimit,
    requireJsonBody,
    bodyReading,
    express.json({ limit: snapshotMaxBytes, inflate: true, verify: chargeSnapshotBytes }),
    chargeFailedSnapshotBody,
    async (req: Request, res: Response) => {
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
      const receivedAtMs = now();
      ingest.ingest(snapshot.data, receivedAtMs);
      // ADR-0037: "apparent" ingest lag, since the agent's clock skew is included; an agent clock running ahead would
      // make it negative, so it is clamped at 0.
      metrics.histogram("satis.agent.ingest.lag", { server: agent.publicId }, Math.max(0, receivedAtMs - Date.parse(snapshot.data.observedAt)));
      if (versions.get(agent.serverUuid) !== snapshot.data.agentVersion) {
        versions.set(agent.serverUuid, snapshot.data.agentVersion);
        void deps.recordVersion(agent.serverUuid, snapshot.data.agentVersion).catch(() => versions.delete(agent.serverUuid));
      }
      // `commandsPending` tells the agent to call GET /commands now (a hint: its long-poll would find the command too).
      sendValidated(res, SnapshotResponseSchema, { cadence: deps.cadence(), commandsPending: await deps.commands.hasPending(agent.serverUuid) });
    },
  );

  // GET /commands?waitSeconds=0..25: the agent's long-poll. Answered as soon as a command exists for its server, or empty
  // when the wait is up (the agent asks again). The wait ends early if the agent hangs up. One open poll per credential
  // (#514): a new one ends the old one, which is answered with an empty list (an agent whose old connection is half-open
  // after a network change is never refused, and a credential can't hold dozens of connections open).
  router.get(agentRoutePath(endpoints.agentApi.commands.route), deps.auth, commandsRateLimit, async (req, res) => {
    const agent = res.locals.agent as AgentIdentity;
    const query = AgentCommandsQuerySchema.safeParse(req.query);
    if (!query.success) throw new BadRequestError("The query is not valid");
    const stop = new AbortController();
    let hungUp = false;
    res.on("close", () => {
      hungUp = true;
      stop.abort();
    });
    openPolls.get(agent.serverUuid)?.abort();
    openPolls.set(agent.serverUuid, stop);
    let commands;
    try {
      commands = await deps.commands.poll(agent, query.data.waitSeconds, stop.signal);
    } finally {
      if (openPolls.get(agent.serverUuid) === stop) openPolls.delete(agent.serverUuid);
    }
    if (hungUp) return; // nobody is listening
    // Ended by a newer poll: whatever the claim returned is still this poll's to deliver (an empty list otherwise).
    sendValidated(res, AgentCommandsResponseSchema, { commands });
  });

  // POST /commands/:commandId/result: the agent reports what happened, as a CODE (never free text). Only for a command of
  // ITS OWN server; unknown and other servers' ids are the same 404, an expired one a 409.
  router.post(
    agentRoutePath(endpoints.agentApi.result.route),
    deps.auth,
    commandsRateLimit,
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
