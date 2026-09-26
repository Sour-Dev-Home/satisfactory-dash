import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { createApp } from "../app.js";
import { createLogger } from "./logger.js";
import { MAX_STORED_CALLS, recordUpstreamCall, requestTiming, serverTimingValue, summarize, unionMs } from "./requestTiming.js";

// ADR-0032 step 1: a request's time split into app and upstream (the game server), in the Server-Timing header and on its
// log line.

describe("unionMs", () => {
  it("merges overlapping intervals (two parallel calls kept the request waiting once, not twice)", () => {
    expect(unionMs([{ startMs: 10, endMs: 40 }, { startMs: 30, endMs: 60 }, { startMs: 20, endMs: 30 }], 0, 100)).toBe(50);
  });

  it("adds separate intervals and ignores empty ones", () => {
    expect(unionMs([{ startMs: 0, endMs: 10 }, { startMs: 20, endMs: 25 }, { startMs: 50, endMs: 50 }], 0, 100)).toBe(15);
  });

  it("counts a contained interval once and touching intervals as one run", () => {
    expect(unionMs([{ startMs: 0, endMs: 100 }, { startMs: 10, endMs: 20 }], 0, 100)).toBe(100);
    expect(unionMs([{ startMs: 0, endMs: 10 }, { startMs: 10, endMs: 20 }], 0, 100)).toBe(20);
  });

  it("clips to the request's own window (a call cannot be longer than the request)", () => {
    expect(unionMs([{ startMs: -50, endMs: 20 }, { startMs: 90, endMs: 500 }], 0, 100)).toBe(30);
  });

  it("is 0 for nothing, whatever the order the calls arrived in", () => {
    expect(unionMs([], 0, 100)).toBe(0);
    expect(unionMs([{ startMs: 50, endMs: 60 }, { startMs: 0, endMs: 10 }], 0, 100)).toBe(20);
  });
});

describe("summarize", () => {
  it("app is the request's wall time minus the union of the upstream calls, with vanilla and frm apart", () => {
    const summary = summarize(
      {
        startMs: 0,
        callCount: 3,
        calls: [
          { upstream: "vanilla", startMs: 10, endMs: 40 },
          { upstream: "frm", startMs: 30, endMs: 60 },
          { upstream: "frm", startMs: 20, endMs: 30 },
        ],
      },
      100,
    );
    expect(summary).toEqual({ totalMs: 100, upstreamMs: 50, appMs: 50, vanillaMs: 30, frmMs: 40, upstreamCalls: 3 });
  });

  it("a request that never called the game has 0 upstream", () => {
    expect(summarize({ startMs: 5, callCount: 0, calls: [] }, 25)).toEqual({ totalMs: 20, upstreamMs: 0, appMs: 20, vanillaMs: 0, frmMs: 0, upstreamCalls: 0 });
  });

  it("app never goes negative", () => {
    expect(summarize({ startMs: 0, callCount: 1, calls: [{ upstream: "frm", startMs: 0, endMs: 10 }] }, 10).appMs).toBe(0);
  });
});

describe("serverTimingValue", () => {
  it("is `app;dur=..., upstream;dur=...` with one decimal, both always present", () => {
    expect(serverTimingValue({ totalMs: 0, appMs: 12.34, upstreamMs: 45.67, vanillaMs: 0, frmMs: 0, upstreamCalls: 1 })).toBe("app;dur=12.3, upstream;dur=45.7");
    expect(serverTimingValue({ totalMs: 0, appMs: 3, upstreamMs: 0, vanillaMs: 0, frmMs: 0, upstreamCalls: 0 })).toBe("app;dur=3, upstream;dur=0");
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

describe("unionMs against a brute-force count", () => {
  it("agrees on every grid of small integer intervals (unsorted, nested, empty, clipped)", () => {
    let seed = 12345;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    for (let round = 0; round < 500; round++) {
      const intervals = Array.from({ length: rnd(7) }, () => {
        const a = rnd(14) - 2;
        return { startMs: a, endMs: a + rnd(8) - 1 };
      });
      const from = rnd(4);
      const to = from + rnd(10);
      let expected = 0;
      for (let cell = from; cell < to; cell++) if (intervals.some((i) => i.startMs <= cell && cell + 1 <= i.endMs)) expected++;
      expect(unionMs(intervals, from, to)).toBe(expected);
    }
  });
  it("ignores NaN and treats an infinite end as the window end", () => {
    expect(unionMs([{ startMs: NaN, endMs: 5 }, { startMs: 1, endMs: Infinity }], 0, 10)).toBe(9);
  });
});

describe("writeHead variants", () => {
  it("still adds the headers when the handler calls writeHead with a status message and a headers object, and on HEAD", async () => {
    const app = express();
    app.use(requestTiming({ allowedOrigins: ["https://a.example"] }));
    app.get("/w", (_req, res) => {
      res.writeHead(200, "fine", { "X-Test": "1" });
      res.end("x");
    });
    const res = await request(app).get("/w").set("Origin", "https://a.example");
    expect(res.headers["server-timing"]).toMatch(/^app;dur=\d+(\.\d)?, upstream;dur=\d+(\.\d)?$/);
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
    app.get("/game", async (_req, res) => {
      // Two parallel calls and one on the other API, made after an await (still inside this request).
      await Promise.resolve();
      recordUpstreamCall({ upstream: "vanilla", startMs: 10, endMs: 40 });
      recordUpstreamCall({ upstream: "frm", startMs: 30, endMs: 60 });
      res.json({ ok: true });
    });
    app.get("/plain", (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  it("puts Server-Timing on the response, with the union of the calls as upstream", async () => {
    const res = await request(scripted()).get("/game");
    expect(res.headers["server-timing"]).toBe("app;dur=50, upstream;dur=50");
  });

  it("says upstream 0 for a route that never called the game", async () => {
    const res = await request(scripted()).get("/plain");
    expect(res.headers["server-timing"]).toBe("app;dur=100, upstream;dur=0");
  });

  it("keeps two concurrent requests apart (each call is reported into the request that made it)", async () => {
    const app = express();
    app.use(requestTiming());
    app.get("/a", async (_req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      recordUpstreamCall({ upstream: "frm", startMs: performance.now() - 4, endMs: performance.now() });
      res.json({});
    });
    app.get("/b", async (_req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      res.json({});
    });
    const [a, b] = await Promise.all([request(app).get("/a"), request(app).get("/b")]);
    expect(a.headers["server-timing"]).toMatch(/upstream;dur=[1-9]/);
    expect(b.headers["server-timing"]).toMatch(/upstream;dur=0$/);
  });

  it("recording outside a request (the pollers, startup) is a harmless no-op", () => {
    expect(() => recordUpstreamCall({ upstream: "frm", startMs: 0, endMs: 1 })).not.toThrow();
  });

  it("stores a bounded number of calls per request, and still counts the rest (the log line says how many there were)", async () => {
    const lines: string[] = [];
    const app = createApp({
      logger: createLogger({ level: "info" }, { write: (line: string) => lines.push(line) }),
      routers: [
        express.Router().get("/many", (_req, res) => {
          for (let i = 0; i < MAX_STORED_CALLS + 50; i++) recordUpstreamCall({ upstream: "frm", startMs: 0, endMs: 1 });
          res.json({});
        }),
      ],
    });
    expect((await request(app).get("/api/many")).status).toBe(200);
    const line = JSON.parse(lines.find((l) => l.includes('"res"')) ?? "{}") as { upstreamCalls?: number };
    expect(line.upstreamCalls).toBe(MAX_STORED_CALLS + 50);
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
      expect(res.headers["server-timing"], path).toMatch(/^app;dur=[\d.]+, upstream;dur=0$/);
    }
  });

  it("puts appMs, upstreamMs, vanillaMs, frmMs and upstreamCalls on the request's log line, and nothing else about the game", async () => {
    const lines: string[] = [];
    const { app } = timedApp({}, lines);
    await request(app).get("/api/nothing-here");
    const line = JSON.parse(lines.find((l) => l.includes('"res"')) ?? "{}") as Record<string, unknown>;
    expect(line).toMatchObject({ upstreamMs: 0, vanillaMs: 0, frmMs: 0, upstreamCalls: 0 });
    expect(typeof line.appMs).toBe("number");
    expect(typeof line.responseTime).toBe("number");
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
