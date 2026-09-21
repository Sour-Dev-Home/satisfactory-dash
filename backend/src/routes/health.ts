import { Router } from "express";
import type { HealthResponse } from "@satisfactory-dash/shared";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  const body: HealthResponse = { status: "ok" };
  res.json(body);
});
