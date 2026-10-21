import { describe, it, expect } from "vitest";
import request from "supertest";
import { Router } from "express";
import { createApp } from "../app.js";
import { createLogger } from "./logger.js";

describe("request log lines", () => {
  function build() {
    const lines: string[] = [];
    const router = Router();
    router.get("/auth/google/callback", (_req, res) => void res.status(204).end());
    router.get("/other", (_req, res) => void res.status(204).end());
    const app = createApp({
      logger: createLogger({ level: "info" }, { write: (line: string) => lines.push(line) }),
      allowedOrigins: [],
      routers: [router],
    });
    return { app, lines };
  }

  it("keep only the path of the Google callback, never its one-time code or state", async () => {
    const { app, lines } = build();
    await request(app).get("/api/auth/google/callback?code=SECRET-CODE-123&state=SECRET-STATE-456");
    const text = lines.join("\n");
    expect(text).toContain("/api/auth/google/callback");
    expect(text).not.toContain("SECRET-CODE-123");
    expect(text).not.toContain("SECRET-STATE-456");
  });

  it("log every URL as its path only, without the query string", async () => {
    const { app, lines } = build();
    await request(app).get("/api/other?x=1&email=a@b.c");
    const text = lines.join(" ");
    expect(text).toContain("/api/other");
    expect(text).not.toContain("x=1");
    expect(text).not.toContain("a@b.c");
  });

  it("carry no client IP, neither the resolved one nor the socket address", async () => {
    const { app, lines } = build();
    await request(app).get("/api/other").set("CF-Connecting-IP", "203.0.113.9");
    const line = JSON.parse(lines[0]!) as Record<string, unknown> & { req: Record<string, unknown> };
    expect(line.clientIp).toBeUndefined();
    expect(line.req.remoteAddress).toBeUndefined();
    expect(lines.join(" ")).not.toContain("203.0.113.9");
    expect(line.req.headers).toBeDefined();
  });
});
