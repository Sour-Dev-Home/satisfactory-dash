import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createReadinessRouter } from "../health.js";

const appWith = (isReady: () => Promise<boolean>) => express().use("/api", createReadinessRouter(isReady));

describe("GET /api/health/ready", () => {
  it("is 200 ok when ready", async () => {
    const res = await request(appWith(async () => true)).get("/api/health/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("is 503 unavailable, with no detail, when not ready", async () => {
    const res = await request(appWith(async () => false)).get("/api/health/ready");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "unavailable" });
  });

  it("is 503 (never a 500 or a leak) when the check throws", async () => {
    const res = await request(
      appWith(async () => {
        throw new Error("postgres://u:hunter2@h/d");
      }),
    ).get("/api/health/ready");
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain("hunter2");
  });
});
