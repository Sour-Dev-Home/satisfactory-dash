import { Router } from "express";
import { HealthResponseSchema } from "@satisfactory-dash/shared";
import { sendValidated } from "./sendValidated.js";

export const healthRouter = Router();

/** Liveness: the process is up. It never touches a dependency (ADR-0025 decision 6). */
healthRouter.get("/health", (_req, res) => {
  sendValidated(res, HealthResponseSchema, { status: "ok" });
});

/**
 * Readiness (ADR-0025 decision 6): 200 `{ status: "ok" }` when the dependencies the backend needs
 * answer, else 503 `{ status: "unavailable" }`. The body never says WHICH dependency failed: the
 * endpoint is public. Its schema joins the shared contract in PR 4 (additive, deploy-skew rule);
 * until then it is a plain body, and nothing in the frontend reads it.
 */
export function createReadinessRouter(isReady: () => Promise<boolean>): Router {
  const router = Router();
  router.get("/health/ready", async (_req, res) => {
    let ready = false;
    try {
      ready = await isReady();
    } catch {
      ready = false;
    }
    res.setHeader("Cache-Control", "no-store");
    res.status(ready ? 200 : 503).json({ status: ready ? "ok" : "unavailable" });
  });
  return router;
}
