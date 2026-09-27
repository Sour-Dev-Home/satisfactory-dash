import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { Logger } from "pino";
import { requestTiming } from "../requestTiming.js";
import { requestMetrics } from "./requestMetrics.js";
import { createMetricsAggregator, type MetricsAggregator } from "./aggregator.js";

/** A minimal stand-in for Express's Response: an EventEmitter (for "finish") plus the handful of
 *  members requestTiming()'s writeHead patch touches. */
function fakeResponse() {
  const res = new EventEmitter() as unknown as {
    locals: Record<string, unknown>;
    headersSent: boolean;
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    vary: (field: string) => void;
    writeHead: (...args: unknown[]) => unknown;
  } & EventEmitter;
  res.locals = {};
  res.headersSent = false;
  res.statusCode = 200;
  res.setHeader = vi.fn();
  res.vary = vi.fn();
  res.writeHead = () => {
    res.headersSent = true;
  };
  return res;
}

function fakeRequest(routePath: string | undefined, baseUrl = "/api") {
  return { headers: {}, route: routePath ? { path: routePath } : undefined, baseUrl } as never;
}

/** Runs requestTiming() then requestMetrics() against the same req/res, as app.ts mounts them. */
function drive(req: unknown, res: ReturnType<typeof fakeResponse>, aggregator: MetricsAggregator, logger: Logger) {
  requestTiming()(req as never, res as never, vi.fn());
  requestMetrics(aggregator, logger)(req as never, res as never, vi.fn());
}

describe("requestMetrics", () => {
  it("records http.server.request.duration with the matched route pattern and status class", () => {
    const req = fakeRequest("/servers/:serverId/status");
    const res = fakeResponse();
    const aggregator = createMetricsAggregator();
    drive(req, res, aggregator, { warn: vi.fn() } as unknown as Logger);
    res.statusCode = 200;
    res.writeHead(); // Express freezes the timing summary here, before the body is sent
    res.emit("finish");
    const [delta] = aggregator.drain();
    expect(delta.metric).toBe("http.server.request.duration");
    expect(delta.labels).toEqual({ route: "/api/servers/:serverId/status", status_class: "2xx" });
    expect(delta.count).toBe(1);
  });

  it("labels a 5xx response correctly", () => {
    const req = fakeRequest("/x");
    const res = fakeResponse();
    const aggregator = createMetricsAggregator();
    drive(req, res, aggregator, { warn: vi.fn() } as unknown as Logger);
    res.statusCode = 503;
    res.writeHead();
    res.emit("finish");
    expect(aggregator.drain()[0].labels.status_class).toBe("5xx");
  });

  it.each([
    [0, "1xx"], // never happens over HTTP, but statusClass must not produce "0xx" (outside the registry's isStatusClass)
    [99, "1xx"],
    [100, "1xx"],
    [199, "1xx"],
    [200, "2xx"],
    [599, "5xx"],
    [600, "5xx"],
    [999, "5xx"],
  ])("clamps status %i to status_class %s, never a value the registry would refuse", (statusCode, expectedClass) => {
    const req = fakeRequest("/x");
    const res = fakeResponse();
    const aggregator = createMetricsAggregator();
    drive(req, res, aggregator, { warn: vi.fn() } as unknown as Logger);
    res.statusCode = statusCode;
    res.writeHead();
    res.emit("finish");
    const [delta] = aggregator.drain();
    expect(delta.labels.status_class).toBe(expectedClass);
  });

  it("skips a request with no matched route (e.g. a 404), rather than recording an open-ended label", () => {
    const req = fakeRequest(undefined);
    const res = fakeResponse();
    const aggregator = createMetricsAggregator();
    drive(req, res, aggregator, { warn: vi.fn() } as unknown as Logger);
    res.statusCode = 404;
    res.writeHead();
    res.emit("finish");
    expect(aggregator.drain()).toEqual([]);
  });

  it("catches a recording failure and logs it, rather than throwing out of a 'finish' listener", () => {
    const req = fakeRequest("/x");
    const res = fakeResponse();
    const badAggregator: MetricsAggregator = {
      recordHistogram: () => {
        throw new Error("boom");
      },
      recordCounter: vi.fn(),
      drain: () => [],
    };
    const logger = { warn: vi.fn() } as unknown as Logger;
    drive(req, res, badAggregator, logger);
    res.statusCode = 200;
    res.writeHead();
    expect(() => res.emit("finish")).not.toThrow();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
