import { Router } from "express";
import type { ServerStatusService } from "../services/serverStatusService.js";
import { formatErrorDetail } from "./formatErrorDetail.js";

export function createStatusRouter(service: ServerStatusService): Router {
  const router = Router();
  router.get("/status", async (_req, res) => {
    try {
      res.json(await service.getStatus());
    } catch (err) {
      res.status(503).json({ error: "Could not reach the Satisfactory dedicated server", detail: formatErrorDetail(err) });
    }
  });
  return router;
}
