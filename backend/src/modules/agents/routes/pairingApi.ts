import express, { Router } from "express";
import {
  PairingPollRequestSchema,
  PairingPollResponseSchema,
  PairingStartRequestSchema,
  PairingStartResponseSchema,
  endpoints,
} from "@satisfactory-dash/shared";
import { BadRequestError, RateLimitedError } from "../../../platform/errorResponse.js";
import { requireJsonBody } from "../../../platform/httpPolicy.js";
import { sendValidated } from "../../../platform/sendValidated.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import { PAIRING_POLL_PER_NETWORK_PER_MINUTE, PAIRING_START_GLOBAL_PER_HOUR, PAIRING_START_PER_NETWORK_PER_HOUR } from "../config.js";
import { rateLimitKey } from "../services/clientKey.js";
import type { PairingService } from "../services/pairingService.js";
import { agentRoutePath } from "./agentApi.js";

export interface PairingApiDeps {
  service: PairingService;
  /** False until the database servers are loaded: answered 503 (the agent retries). */
  isReady?: () => boolean;
  /** Per client network, default 6 an hour. */
  startLimiter?: UserRateLimiter;
  /** Across every caller, default 600 an hour. */
  globalStartLimiter?: UserRateLimiter;
  /** Per client network, default 120 a minute. */
  pollLimiter?: UserRateLimiter;
}

/**
 * ADR-0051 section 1: the agent's side of device-code pairing, at /agent/v1/pairings (unauthenticated, like enrol). The
 * secret is read from a request BODY only and nothing here logs a body. A body that fails its schema gets a FIXED message.
 */
export function createPairingApiRouter(deps: PairingApiDeps): Router {
  const router = Router();
  const startLimiter = deps.startLimiter ?? new UserRateLimiter({ max: PAIRING_START_PER_NETWORK_PER_HOUR, windowMs: 3_600_000 });
  const globalStartLimiter = deps.globalStartLimiter ?? new UserRateLimiter({ max: PAIRING_START_GLOBAL_PER_HOUR, windowMs: 3_600_000 });
  const pollLimiter = deps.pollLimiter ?? new UserRateLimiter({ max: PAIRING_POLL_PER_NETWORK_PER_MINUTE, windowMs: 60_000 });
  const { startPairing, pollPairing } = endpoints.agentApi;

  router.post(agentRoutePath(startPairing.route), requireJsonBody, express.json({ limit: "4kb" }), async (req, res) => {
    // As enrol: the network first, the process-wide budget only for requests that pass it (a refused network never spends
    // it), and a global refusal gives the network's hit back.
    const network = rateLimitKey(req);
    const networkWait = startLimiter.hit(network);
    if (networkWait > 0) throw new RateLimitedError(networkWait, "Too many pairing requests. Try again later.");
    const globalWait = globalStartLimiter.hit("all");
    if (globalWait > 0) {
      startLimiter.refund(network);
      throw new RateLimitedError(globalWait, "Too many pairing requests. Try again later.");
    }
    const body = PairingStartRequestSchema.safeParse(req.body);
    if (!body.success) throw new BadRequestError("The request body is not valid");
    const started = await deps.service.start(body.data);
    res.status(201);
    sendValidated(res, PairingStartResponseSchema, started);
  });

  router.post(agentRoutePath(pollPairing.route), requireJsonBody, express.json({ limit: "4kb" }), async (req, res) => {
    const wait = pollLimiter.hit(rateLimitKey(req));
    if (wait > 0) throw new RateLimitedError(wait, "Too many pairing polls. Slow down.");
    const body = PairingPollRequestSchema.safeParse(req.body);
    if (!body.success) throw new BadRequestError("The request body is not valid");
    const outcome = await deps.service.poll(body.data.pairingSecret);
    // `approved` carries the credential, exactly enrol's 201; every other status is a plain 200.
    if (outcome.status === "approved") res.status(201);
    res.set("Cache-Control", "no-store");
    sendValidated(res, PairingPollResponseSchema, outcome);
  });

  return router;
}
