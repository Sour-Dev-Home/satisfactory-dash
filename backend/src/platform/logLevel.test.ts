import { describe, it, expect } from "vitest";
import { Router } from "express";
import request from "supertest";
import { createApp } from "../app.js";
import { createLogger } from "./logger.js";
import { RateLimitedError, UnauthorizedError } from "./errorResponse.js";
import { requestLogLevel } from "./logLevel.js";

describe("requestLogLevel", () => {
  it.each([
    [500, "error"],
    [503, "error"],
    [429, "warn"],
    [404, "warn"],
    [400, "warn"],
    [401, "info"],
    [200, "info"],
    [204, "info"],
    [302, "info"],
  ] as const)("a %i is logged at %s", (status, level) => {
    expect(requestLogLevel(status)).toBe(level);
  });

  it("a handled client error (an error object with a 4xx status) is not an error", () => {
    expect(requestLogLevel(401, new UnauthorizedError("Sign in to continue"))).toBe("info");
    expect(requestLogLevel(404, new Error("nope"))).toBe("warn");
  });

  it("an error with a non-error status, or a 5xx, is an error", () => {
    expect(requestLogLevel(200, new Error("threw after sending"))).toBe("error");
    expect(requestLogLevel(500, new Error("boom"))).toBe("error");
  });
});

// The real pipeline: the request line (pino-http) and the failure line (error handler) both follow the rule.
describe("log levels in the real request pipeline", () => {
  const LEVEL = { info: 30, warn: 40, error: 50 };

  async function levelsFor(behaviour: () => never | void) {
    const lines: { level: number }[] = [];
    const logger = createLogger({ level: "info" }, { write: (line: string) => lines.push(JSON.parse(line)) });
    const router = Router();
    router.get("/x", () => behaviour());
    const app = createApp({ logger, routers: [router] });
    const res = await request(app).get("/api/x");
    return { status: res.status, levels: [...new Set(lines.map((l) => l.level))].sort() };
  }

  it("a 401 (Sign in to continue) never reaches level 50, and is info", async () => {
    const { status, levels } = await levelsFor(() => {
      throw new UnauthorizedError("Sign in to continue");
    });
    expect(status).toBe(401);
    expect(levels).toEqual([LEVEL.info]);
  });

  it("a 429 is a warning", async () => {
    const { status, levels } = await levelsFor(() => {
      throw new RateLimitedError(30);
    });
    expect(status).toBe(429);
    expect(levels).toEqual([LEVEL.warn]);
  });

  it("an unknown route (404) is a warning", async () => {
    const lines: { level: number }[] = [];
    const logger = createLogger({ level: "info" }, { write: (line: string) => lines.push(JSON.parse(line)) });
    const res = await request(createApp({ logger, routers: [] })).get("/api/nothing-here");
    expect(res.status).toBe(404);
    expect(new Set(lines.map((l) => l.level))).toEqual(new Set([LEVEL.warn]));
  });

  it("an unexpected failure (500) is an error", async () => {
    const { status, levels } = await levelsFor(() => {
      throw new Error("kaboom");
    });
    expect(status).toBe(500);
    expect(levels).toEqual([LEVEL.error]);
  });

  it("a successful request is info", async () => {
    const lines: { level: number }[] = [];
    const logger = createLogger({ level: "info" }, { write: (line: string) => lines.push(JSON.parse(line)) });
    const router = Router();
    router.get("/ok", (_req, res) => void res.json({ ok: true }));
    const res = await request(createApp({ logger, routers: [router] })).get("/api/ok");
    expect(res.status).toBe(200);
    expect(new Set(lines.map((l) => l.level))).toEqual(new Set([LEVEL.info]));
  });
});
