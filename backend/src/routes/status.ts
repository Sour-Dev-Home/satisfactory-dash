import { Router } from "express";
import type { ServerStatusService } from "../services/serverStatusService.js";

export function createStatusRouter(service: ServerStatusService): Router {
  const router = Router();
  router.get("/status", async (_req, res) => {
    try {
      res.json(await service.getStatus());
    } catch (err) {
      res.status(503).json({ error: "Could not reach the Satisfactory dedicated server", detail: String(err) });
    }
  });
  return router;
}
