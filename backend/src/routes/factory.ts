import { Router } from "express";
import type { ProductionService } from "../services/productionService.js";
import { buildServerUnreachableResponse } from "./errorResponse.js";

export function createFactoryRouter(service: ProductionService): Router {
  const router = Router();
  router.get("/factory", async (_req, res) => {
    try {
      res.json(await service.getFactoryOverview());
    } catch (err) {
      res.status(503).json(buildServerUnreachableResponse(err));
    }
  });
  return router;
}
