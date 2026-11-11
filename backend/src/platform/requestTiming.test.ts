import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { createApp } from "../app.js";
import { createLogger } from "./logger.js";
import { requestTiming, serverTimingValue } from "./requestTiming.js";

// ADR-0032 step 1: a request's time, in the Server-Timing header and on its log line. ADR-0066 removed the game-server
// ("upstream") part: the backend no longer calls a game server.

describe("serverTimingValue", () => {
  it("is `app;dur=...` with one decimal, and nothing about a game server", () => {
    expect(serverTimingValue({ totalMs: 12.34 })).toBe("app;dur=12.3");
    expect(serverTimingValue({ totalMs: 3 })).toBe("app;dur=3");
  });
});

/** The real app, with its log lines captured. */
function timedApp(options: { allowedOrigins?: string[] } = {}, lines: string[] = []) {
  const app = createApp({
    logger: createLogger({ level: "info" }, { write: (line: string) => lines.push(line) }),
    routers: [],
    allowedOrigins: options.allowedOrigins,
  });
  return { app, lines };
}

describe("writeHead variants", () => {
  it("still adds the headers when the handler calls writeHead with a status message and a headers object, and on HEAD", async () => {
    const app = express();
    app.use(requestTiming({ allowedOrigins: ["https://a.example"] }));
    app.get("/w", (_req, res) => {
      res.writeHead(200, "fine", { "X-Test": "1" });
      res.end("x");
    });
    const res = await request(app).get("/w").set("Origin", "https://a.example");
    expect(res.headers["server-timing"]).toMatch(/^app;dur=\d+(\.\d)?$/);
    expect(res.headers["x-test"]).toBe("1");
    const head = await request(app).head("/w");
    expect(head.headers["server-timing"]).toBeDefined();
  });
});

describe("the middleware", () => {
  function scripted(allowedOrigins: string[] = []) {
    const app = express();
    let ticks = 0;
    app.use(requestTiming({ allowedOrigins, now: () => [0, 100][Math.min(ticks++, 1)]! }));
    app.get("/plain", async (_req, res) => {
      await Promise.resolve();
      res.json({ ok: true });
    });
    return app;
  }

  it("puts the request's wall time on the response as Server-Timing app", async () => {
    const res = await request(scripted()).get("/plain");
    expect(res.headers["server-timing"]).toBe("app;dur=100");
  });

  describe("Timing-Allow-Origin", () => {
    it("echoes an allowed origin so the browser lets the page read the timing, and varies on Origin", async () => {
      const res = await request(scripted(["https://app.example"])).get("/plain").set("Origin", "https://app.example");
      expect(res.headers["timing-allow-origin"]).toBe("https://app.example");
      expect(res.headers.vary).toMatch(/Origin/);
    });

    it("never sends it to an origin that is not allowed, or without an Origin, or with no allowlist", async () => {
      const allowed = scripted(["https://app.example"]);
      expect((await request(allowed).get("/plain").set("Origin", "https://evil.example")).headers["timing-allow-origin"]).toBeUndefined();
      expect((await request(allowed).get("/plain")).headers["timing-allow-origin"]).toBeUndefined();
      expect((await request(scripted()).get("/plain").set("Origin", "https://app.example")).headers["timing-allow-origin"]).toBeUndefined();
    });

    it("is never a wildcard", async () => {
      const res = await request(scripted(["https://app.example"])).get("/plain").set("Origin", "https://app.example");
      expect(res.headers["timing-allow-origin"]).not.toBe("*");
    });
  });
});

describe("in the real app", () => {
  it("adds Server-Timing to every response, error envelopes and the agent API's included", async () => {
    const { app } = timedApp();
    for (const path of ["/api/nothing-here", "/agent/v1/nothing-here"]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(404);
      expect(res.headers["server-timing"], path).toMatch(/^app;dur=[\d.]+$/);
    }
  });

  it("puts appMs on the request's log line, and no game-server timing fields", async () => {
    const lines: string[] = [];
    const { app } = timedApp({}, lines);
    await request(app).get("/api/nothing-here");
    const line = JSON.parse(lines.find((l) => l.includes('"res"')) ?? "{}") as Record<string, unknown>;
    expect(typeof line.appMs).toBe("number");
    expect(typeof line.responseTime).toBe("number");
    for (const gone of ["upstreamMs", "vanillaMs", "frmMs", "upstreamCalls"]) expect(line, gone).not.toHaveProperty(gone);
  });

  it("logs the route PATTERN a request matched (never the concrete URL) so a report can group by route", async () => {
    const lines: string[] = [];
    const app = createApp({
      logger: createLogger({ level: "info" }, { write: (line: string) => lines.push(line) }),
      routers: [
        express.Router().get("/servers/:serverId/status", (_req, res) => {
          res.json({ ok: true });
        }),
      ],
    });
    await request(app).get("/api/servers/alpha/status?x=1");
    await request(app).get("/api/servers/bravo/status");
    const routes = lines.map((l) => (JSON.parse(l) as { route?: string }).route).filter((r) => r !== undefined);
    expect(routes).toEqual(["/api/servers/:serverId/status", "/api/servers/:serverId/status"]);
  });

  it("logs no route for a request no route handled", async () => {
    const lines: string[] = [];
    const { app } = timedApp({}, lines);
    await request(app).get("/api/nothing-here");
    const line = JSON.parse(lines.find((l) => l.includes('"res"')) ?? "{}") as { route?: string };
    expect(line.route).toBeUndefined();
  });
});
