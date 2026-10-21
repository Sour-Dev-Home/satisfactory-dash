import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAP_WORLD_LAYER_MAX_BYTES, RailsWorldIngestRequestSchema, ResourceNodesWorldIngestRequestSchema } from "@satisfactory-dash/shared";
import type { ConveyorEdge, MapWorldLayer, RailSegment, ResourceNode } from "@satisfactory-dash/shared";
import { BackendError } from "./backendClient.js";
import type { AgentLogger, LogFields } from "./logger.js";
import { CONVEYORS_INTERVAL_MS, RAILS_INTERVAL_MS, RESOURCE_NODES_INTERVAL_MS, WORLD_JITTER_FRACTION, WorldReader, jitteredIntervalMs } from "./worldReader.js";
import type { WorldClient, WorldPorts } from "./worldReader.js";

/** Fake timers drive the reader's sleeps; a fake adapter stands in for the game and a fake client for the backend. */

const rail = (x: number): RailSegment => ({ points: [[x, 0], [x + 10, 0]] }) as unknown as RailSegment;
const edge = (id: string): ConveyorEdge => ({ id, kind: "belt", from: "a", fromKind: "machine", to: null, toKind: null, capacityPerMinute: 60, tier: "Conveyor Belt Mk.1", at: { x: 0, y: 0 } });
const node = (x: number): ResourceNode => ({ id: `n${x}`, type: "Desc_OreIron_C", purity: "normal", position: [x, 0] }) as unknown as ResourceNode;

function setup(options: { random?: () => number } = {}) {
  const world = { rails: [rail(1)], resourceNodes: [node(1)], conveyors: [edge("b1")] };
  const ports = {
    getRails: vi.fn<WorldPorts["getRails"]>(async () => ({ data: world.rails, dropped: 0 })),
    getResourceNodes: vi.fn<WorldPorts["getResourceNodes"]>(async () => ({ data: world.resourceNodes, dropped: 0 })),
    getConveyors: vi.fn<WorldPorts["getConveyors"]>(async () => ({ data: world.conveyors, dropped: 0 })),
  };
  const sent: { layer: MapWorldLayer; body: { observedAt: string; data: unknown[] } }[] = [];
  const client = {
    postWorldLayer: vi.fn<WorldClient["postWorldLayer"]>(async (layer, body) => {
      sent.push({ layer, body: body as { observedAt: string; data: unknown[] } });
      return { accepted: true, unchanged: false };
    }),
  };
  const lines: { level: string; event: string; fields?: LogFields }[] = [];
  const logger: AgentLogger = {
    info: (event, fields) => lines.push({ level: "info", event, fields }),
    warn: (event, fields) => lines.push({ level: "warn", event, fields }),
    error: (event, fields) => lines.push({ level: "error", event, fields }),
    addSecret() {},
  };
  const onAuthRejected = vi.fn();
  const reader = new WorldReader({ ports, client, logger, onAuthRejected, random: options.random ?? (() => 0.5) });
  const controller = new AbortController();
  let running: Promise<void> = Promise.resolve();
  /** Starts the reader (after the test arranged its world) and lets the first reads run. */
  const start = async () => {
    running = reader.run(controller.signal);
    await vi.advanceTimersByTimeAsync(0); // the first reads
  };
  const stop = async () => {
    controller.abort();
    await vi.advanceTimersByTimeAsync(0); // let the abort land
    await running;
  };
  const sentFor = (layer: MapWorldLayer) => sent.filter((s) => s.layer === layer);
  const warnings = (event: string) => lines.filter((l) => l.event === event);
  return { world, ports, client, sent, sentFor, lines, warnings, onAuthRejected, start, running: () => running, stop };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-14T12:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the world reader's schedule", () => {
  it("rails every 10 minutes and resource nodes (a game-thread endpoint) every 30 minutes, jittered by at most ±10%", () => {
    expect(RAILS_INTERVAL_MS).toBe(600_000);
    expect(RESOURCE_NODES_INTERVAL_MS).toBe(1_800_000);
    expect(CONVEYORS_INTERVAL_MS).toBe(600_000);
    expect(WORLD_JITTER_FRACTION).toBe(0.1);
    for (const r of [0, 0.25, 0.5, 0.75, 0.999999]) {
      const delay = jitteredIntervalMs(RAILS_INTERVAL_MS, () => r);
      expect(delay).toBeGreaterThanOrEqual(540_000);
      expect(delay).toBeLessThanOrEqual(660_000);
    }
    expect(jitteredIntervalMs(RAILS_INTERVAL_MS, () => 0)).toBe(540_000);
    expect(jitteredIntervalMs(RAILS_INTERVAL_MS, () => 0.5)).toBe(600_000);
    expect(jitteredIntervalMs(RESOURCE_NODES_INTERVAL_MS, () => 0)).toBe(1_620_000);
  });

  it("edge: a random source outside [0, 1) still stays within the jitter bounds", () => {
    for (const r of [-5, 7, Number.NaN, Number.POSITIVE_INFINITY]) {
      const delay = jitteredIntervalMs(RAILS_INTERVAL_MS, () => r);
      expect(delay).toBeGreaterThanOrEqual(540_000);
      expect(delay).toBeLessThanOrEqual(660_000);
    }
  });

  it("reads each layer at its own jittered cadence", async () => {
    const h = setup({ random: () => 0 }); // 0.9 of each interval
    await h.start();
    expect(h.ports.getRails).toHaveBeenCalledTimes(1);
    expect(h.ports.getResourceNodes).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(540_000 - 1);
    expect(h.ports.getRails).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.ports.getRails).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_620_000 - 540_000 - 1);
    expect(h.ports.getResourceNodes).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.ports.getResourceNodes).toHaveBeenCalledTimes(2);
    expect(h.ports.getRails).toHaveBeenCalledTimes(4); // at 0, 540, 1080 and 1620 s
    await h.stop();
  });
});

describe("sending only on change", () => {
  it("the first read after start always sends, as the contract's ingest body", async () => {
    const h = setup();
    await h.start();
    expect(h.sentFor("rails")).toHaveLength(1);
    expect(h.sentFor("resourceNodes")).toHaveLength(1);
    const rails = h.sentFor("rails")[0]!.body;
    expect(rails).toEqual({ observedAt: "2026-10-14T12:00:00.000Z", data: h.world.rails });
    expect(Object.keys(rails).sort()).toEqual(["data", "observedAt"]);
    expect(RailsWorldIngestRequestSchema.shape.observedAt.safeParse(rails.observedAt).success).toBe(true);
    expect(ResourceNodesWorldIngestRequestSchema.shape.observedAt.safeParse(h.sentFor("resourceNodes")[0]!.body.observedAt).success).toBe(true);
    await h.stop();
  });

  it("an unchanged hash sends nothing on later reads", async () => {
    const h = setup();
    await h.start();
    await vi.advanceTimersByTimeAsync(3 * 660_000);
    expect(h.ports.getRails.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(h.sentFor("rails")).toHaveLength(1);
    await h.stop();
  });

  it("a changed layer is sent again, and only that layer", async () => {
    const h = setup();
    await h.start();
    h.world.rails = [rail(1), rail(2)];
    await vi.advanceTimersByTimeAsync(660_000);
    expect(h.sentFor("rails")).toHaveLength(2);
    expect(h.sentFor("rails")[1]!.body.data).toEqual([rail(1), rail(2)]);
    expect(h.sentFor("resourceNodes")).toHaveLength(1);
    await h.stop();
  });

  it("edge: the hash is over the projected data, not observedAt: a later read of the same world at a new time sends nothing", async () => {
    const h = setup();
    await h.start();
    h.world.rails = h.world.rails.map((r) => ({ ...r })); // equal content, new objects
    await vi.advanceTimersByTimeAsync(660_000);
    expect(h.sentFor("rails")).toHaveLength(1);
    await h.stop();
  });

  it("edge: an empty layer is a real value: sent once on start, then once when it stops being empty", async () => {
    const h = setup();
    h.world.rails = [];
    await h.start();
    expect(h.sentFor("rails")[0]!.body.data).toEqual([]);
    await vi.advanceTimersByTimeAsync(660_000);
    expect(h.sentFor("rails")).toHaveLength(1);
    h.world.rails = [rail(3)];
    await vi.advanceTimersByTimeAsync(660_000);
    expect(h.sentFor("rails")).toHaveLength(2);
    await h.stop();
  });

  it("edge: the mapper's dropped count is logged as a count, and the surviving items are still sent", async () => {
    const h = setup();
    h.ports.getRails.mockResolvedValueOnce({ data: [rail(1)], dropped: 3 });
    await h.start();
    expect(h.warnings("world_layer_items_dropped")).toEqual([{ level: "warn", event: "world_layer_items_dropped", fields: { layer: "rails", dropped: 3 } }]);
    expect(h.sentFor("rails")).toHaveLength(1);
    await h.stop();
  });
});

// ADR-0048 amendment (PR 2): the conveyors layer rides the same pipeline, on rails' 10 min schedule.
describe("the conveyors layer", () => {
  it("is read on start and every 10 minutes, jittered like rails", async () => {
    const h = setup({ random: () => 0 });
    await h.start();
    expect(h.ports.getConveyors).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(540_000 - 1);
    expect(h.ports.getConveyors).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.ports.getConveyors).toHaveBeenCalledTimes(2);
    await h.stop();
  });

  it("the first read sends as the contract's body, an unchanged hash sends nothing, a change sends again", async () => {
    const h = setup();
    await h.start();
    expect(h.sentFor("conveyors")).toHaveLength(1);
    expect(h.sentFor("conveyors")[0]!.body).toEqual({ observedAt: "2026-10-14T12:00:00.000Z", data: [edge("b1")] });
    h.world.conveyors = h.world.conveyors.map((e) => ({ ...e })); // equal content, new objects
    await vi.advanceTimersByTimeAsync(660_000);
    expect(h.sentFor("conveyors")).toHaveLength(1);
    h.world.conveyors = [edge("b1"), edge("b2")];
    await vi.advanceTimersByTimeAsync(660_000);
    expect(h.sentFor("conveyors")).toHaveLength(2);
    expect(h.sentFor("rails")).toHaveLength(1);
    await h.stop();
  });

  it("a read with `skip` sends nothing, warns once per streak with the reason as a code, and sends again once it clears", async () => {
    const h = setup();
    h.ports.getConveyors.mockResolvedValue({ data: [], dropped: 0, skip: "unsupportedFrm" } as Awaited<ReturnType<WorldPorts["getConveyors"]>>);
    await h.start();
    await vi.advanceTimersByTimeAsync(660_000);
    expect(h.sentFor("conveyors")).toHaveLength(0);
    expect(h.warnings("world_layer_skipped")).toEqual([{ level: "warn", event: "world_layer_skipped", fields: { layer: "conveyors", reason: "unsupportedFrm" } }]);
    expect(h.sentFor("rails")).toHaveLength(1); // the other layers are unaffected
    h.ports.getConveyors.mockResolvedValue({ data: h.world.conveyors, dropped: 0 });
    await vi.advanceTimersByTimeAsync(660_000);
    expect(h.sentFor("conveyors")).toHaveLength(1);
    await h.stop();
  });
});

describe("the size cap", () => {
  const huge = () => [{ points: [[0, 0], [1, 1]], name: "x".repeat(MAP_WORLD_LAYER_MAX_BYTES) } as unknown as RailSegment];

  it("an over-cap layer is skipped with one warning per streak, not every cycle; the other layer is unaffected", async () => {
    const h = setup();
    h.world.rails = huge();
    await h.start();
    await vi.advanceTimersByTimeAsync(3 * 660_000);
    expect(h.sentFor("rails")).toHaveLength(0);
    expect(h.sentFor("resourceNodes")).toHaveLength(1);
    const overCap = h.warnings("world_layer_over_cap");
    expect(overCap).toHaveLength(1);
    expect(overCap[0]!.fields).toMatchObject({ layer: "rails" });
    expect(overCap[0]!.fields!.bytes).toBeGreaterThan(MAP_WORLD_LAYER_MAX_BYTES);
    await h.stop();
  });

  it("edge: once the layer fits again it is sent, and a new streak warns again", async () => {
    const h = setup();
    h.world.rails = huge();
    await h.start();
    h.world.rails = [rail(5)];
    await vi.advanceTimersByTimeAsync(660_000);
    expect(h.sentFor("rails")).toHaveLength(1);
    h.world.rails = huge();
    await vi.advanceTimersByTimeAsync(660_000);
    expect(h.warnings("world_layer_over_cap")).toHaveLength(2);
    await h.stop();
  });

  it("edge: the cap is measured on the serialized body (observedAt included), exactly at the boundary", async () => {
    const h = setup();
    const envelope = Buffer.byteLength(JSON.stringify({ observedAt: "2026-10-14T12:00:00.000Z", data: [{ n: "" }] }));
    const fits = [{ n: "y".repeat(MAP_WORLD_LAYER_MAX_BYTES - envelope) }] as unknown as RailSegment[];
    h.world.rails = fits;
    await h.start();
    expect(h.sentFor("rails")).toHaveLength(1); // exactly the cap is allowed
    h.world.rails = [{ n: "y".repeat(MAP_WORLD_LAYER_MAX_BYTES - envelope + 1) }] as unknown as RailSegment[];
    await vi.advanceTimersByTimeAsync(660_000);
    expect(h.sentFor("rails")).toHaveLength(1);
    expect(h.warnings("world_layer_over_cap")).toHaveLength(1);
    await h.stop();
  });
});

describe("backend errors", () => {
  it("a 5xx or network error backs off and retries the same body until it lands, warning once and logging recovery", async () => {
    const h = setup({ random: () => 0 });
    let failuresLeft = 3;
    h.client.postWorldLayer.mockImplementation(async (layer, body) => {
      if (layer === "rails" && failuresLeft-- > 0) throw new BackendError("transient", "The backend answered 503.", { status: 503 });
      h.sent.push({ layer, body: body as { observedAt: string; data: unknown[] } });
      return { accepted: true, unchanged: false };
    });
    await h.start();
    expect(h.sentFor("rails")).toHaveLength(0);
    // backoffDelayMs with random 0: 500 ms, 1 s, 2 s.
    await vi.advanceTimersByTimeAsync(500 + 1_000 + 2_000);
    expect(h.client.postWorldLayer.mock.calls.filter(([l]) => l === "rails")).toHaveLength(4);
    expect(h.sentFor("rails")).toHaveLength(1);
    expect(h.warnings("world_push_failed")).toHaveLength(1);
    expect(h.lines.filter((l) => l.event === "world_push_recovered")).toHaveLength(1);
    expect(h.ports.getRails).toHaveBeenCalledTimes(1); // the game is not re-read for a retry
    await h.stop();
  });

  it("edge: a transient error honours Retry-After when it is longer than the backoff", async () => {
    const h = setup({ random: () => 0 });
    h.client.postWorldLayer.mockRejectedValueOnce(new BackendError("transient", "429", { status: 429, retryAfterMs: 30_000 }));
    await h.start();
    const calls = () => h.client.postWorldLayer.mock.calls.length;
    const before = calls();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(calls()).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls()).toBe(before + 1);
    await h.stop();
  });

  it("a 4xx is not retried; the layer is tried again at its next read (the backend may not know the route yet)", async () => {
    const h = setup();
    h.client.postWorldLayer.mockImplementation(async (layer) => {
      if (layer === "rails") throw new BackendError("fatal", "refused", { status: 422, code: "validation_failed" });
      return { accepted: true, unchanged: false };
    });
    await h.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.client.postWorldLayer.mock.calls.filter(([l]) => l === "rails")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(660_000);
    expect(h.client.postWorldLayer.mock.calls.filter(([l]) => l === "rails")).toHaveLength(2);
    expect(h.warnings("world_layer_refused")).toHaveLength(1); // one warning per streak
    expect(h.warnings("world_layer_refused")[0]!.fields).toMatchObject({ layer: "rails", status: 422, code: "validation_failed" });
    await h.stop();
  });

  it("a 401 stops the reader and calls onAuthRejected; nothing more is read or sent", async () => {
    const h = setup();
    h.client.postWorldLayer.mockRejectedValue(new BackendError("auth_rejected", "401", { status: 401 }));
    await h.start();
    expect(h.onAuthRejected).toHaveBeenCalled();
    const reads = h.ports.getRails.mock.calls.length + h.ports.getResourceNodes.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2 * RESOURCE_NODES_INTERVAL_MS);
    expect(h.ports.getRails.mock.calls.length + h.ports.getResourceNodes.mock.calls.length).toBe(reads);
    await h.running(); // ends by itself
  });

  it("edge: a game read that fails leaves a gap, warns once per streak, and the next read still sends", async () => {
    const h = setup();
    h.ports.getRails.mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:8080")).mockRejectedValueOnce(new Error("again"));
    await h.start();
    await vi.advanceTimersByTimeAsync(660_000);
    expect(h.sentFor("rails")).toHaveLength(0);
    const failed = h.warnings("world_read_failed");
    expect(failed).toHaveLength(1);
    expect(JSON.stringify(failed)).not.toContain("127.0.0.1"); // a code, never the error's message
    await vi.advanceTimersByTimeAsync(660_000);
    expect(h.sentFor("rails")).toHaveLength(1);
    await h.stop();
  });

  it("edge: an error that is not a BackendError (a bug) is retried as transient, never ends the reader", async () => {
    const h = setup({ random: () => 0 });
    h.client.postWorldLayer.mockRejectedValueOnce(new TypeError("boom"));
    await h.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.sentFor("rails").length + h.sentFor("resourceNodes").length).toBe(2);
    await h.stop();
  });

  it("edge: stopping during a backoff ends the run promptly", async () => {
    const h = setup();
    h.client.postWorldLayer.mockRejectedValue(new BackendError("transient", "down"));
    await h.start();
    await h.stop();
    const calls = h.client.postWorldLayer.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.client.postWorldLayer.mock.calls.length).toBe(calls);
  });
});
