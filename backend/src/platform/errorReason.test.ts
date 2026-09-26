import { describe, expect, it } from "vitest";
import { Router } from "express";
import request from "supertest";
import { ApiErrorResponseSchema } from "@satisfactory-dash/shared";
import { createApp } from "../app.js";
import { createLogger } from "./logger.js";
import { ApiFailure, HTTP_STATUS_BY_CODE, classifyRequestFailure } from "./errorResponse.js";

/** ADR-0027 PR 7: an optional, stable `reason` on the error envelope (webhook_invalid says why it was refused). */

describe("ApiFailure reason", () => {
  it("passes a plain snake_case reason through classification", () => {
    expect(classifyRequestFailure(new ApiFailure("webhook_invalid", "m", "host_not_allowed"))).toEqual({ code: "webhook_invalid", message: "m", reason: "host_not_allowed" });
  });

  it("has no reason key at all when none is given", () => {
    expect(classifyRequestFailure(new ApiFailure("rule_not_found", "m"))).toEqual({ code: "rule_not_found", message: "m" });
  });

  it("drops anything that is not a short lowercase code, so user input can never be echoed as a reason", () => {
    const hostile = [
      "https://discord.com/api/webhooks/123456789012345678/TOKEN",
      "Host_Not_Allowed",
      "host not allowed",
      "host-not-allowed",
      "1starts_with_digit",
      "",
      "x".repeat(41),
      "a\nb",
      "<script>",
    ];
    for (const reason of hostile) {
      const result = classifyRequestFailure(new ApiFailure("webhook_invalid", "m", reason));
      expect(result, reason).not.toHaveProperty("reason");
    }
    expect(classifyRequestFailure(new ApiFailure("webhook_invalid", "m", "x".repeat(40)))).toHaveProperty("reason");
  });

  it("reaches the JSON body of the real error handler, and the body still parses as the shared envelope", async () => {
    const router = Router();
    router.get("/boom", () => {
      throw new ApiFailure("webhook_invalid", "That is not a valid Discord webhook URL", "not_https");
    });
    router.get("/plain", () => {
      throw new ApiFailure("mute_invalid", "Choose a time in the future");
    });
    const app = createApp({ logger: createLogger({ level: "silent" }, { write: () => {} }), allowedOrigins: [], routers: [router] });
    const res = await request(app).get("/api/boom");
    expect(res.status).toBe(HTTP_STATUS_BY_CODE.webhook_invalid);
    expect(ApiErrorResponseSchema.parse(res.body).error).toMatchObject({ code: "webhook_invalid", reason: "not_https" });
    const plain = await request(app).get("/api/plain");
    expect(plain.status).toBe(422);
    expect(plain.body.error).not.toHaveProperty("reason");
  });

  it("the alerts codes map to the statuses in the contract", () => {
    expect(HTTP_STATUS_BY_CODE).toMatchObject({
      rule_not_found: 404,
      rule_item_immutable: 422,
      preset_disable_only: 409,
      rule_kind_not_creatable: 422,
      destination_not_configured: 404,
      webhook_invalid: 422,
      delivery_off: 409,
      mute_invalid: 422,
    });
  });
});
