import { Router } from "express";
import { HealthResponseSchema } from "@satisfactory-dash/shared";
import { sendValidated } from "./sendValidated.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  sendValidated(res, HealthResponseSchema, { status: "ok" });
});
