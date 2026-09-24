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

  it("still log other URLs as before", async () => {
    const { app, lines } = build();
    await request(app).get("/api/other?x=1");
    expect(lines.join("\n")).toContain("/api/other?x=1");
  });
});
