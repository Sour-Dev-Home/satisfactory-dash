import { Router } from "express";
import type { ProductionService } from "../services/productionService.js";

export function createFactoryRouter(service: ProductionService): Router {
  const router = Router();
  // No try/catch: Express 5 forwards a rejected handler to the error middleware
  // (routes/errorResponse.ts), which builds the ADR-0003 error envelope.
  router.get("/factory", async (_req, res) => {
    res.json(await service.getFactoryOverview());
  });
  return router;
}
