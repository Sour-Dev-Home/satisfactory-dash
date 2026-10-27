import { describe, expect, it, vi } from "vitest";
import { LocalWorldPoller } from "./localWorldPoller.js";
import type { LocalWorldPollerPorts } from "./localWorldPoller.js";

function fakeLogger() {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as import("pino").Logger;
}

const empty = { data: [] as unknown[], dropped: 0 };

function fakePorts(overrides: Partial<LocalWorldPollerPorts> = {}): LocalWorldPollerPorts {
  return {
    getRails: vi.fn().mockResolvedValue(empty),
    getResourceNodes: vi.fn().mockResolvedValue(empty),
    getConveyors: vi.fn().mockResolvedValue(empty),
    getTrainRoutes: vi.fn().mockResolvedValue(empty),
    getDroneRoutes: vi.fn().mockResolvedValue(empty),
    getMapMarkers: vi.fn().mockResolvedValue(empty),
    getPowerLines: vi.fn().mockResolvedValue(empty),
    getTrains: vi.fn().mockResolvedValue(empty),
    getTrainStations: vi.fn().mockResolvedValue(empty),
    ...overrides,
  };
}

describe("LocalWorldPoller", () => {
  it("reads rails, resourceNodes, conveyors and mapLive immediately on start, each once", async () => {
    const ports = fakePorts();
    const ingest = { ingest: vi.fn().mockResolvedValue({ accepted: true, unchanged: false }) };
    const mapLive = { record: vi.fn() };
    const poller = new LocalWorldPoller(ports, { logger: fakeLogger(), serverPublicId: "srv-1", ingest, mapLive, jitter: () => 0.5 });
    poller.start();
    await vi.waitFor(() => expect(ports.getRails).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(ports.getResourceNodes).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(ports.getConveyors).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(mapLive.record).toHaveBeenCalledTimes(1));
    await poller.stop();
  });

  it("ingests rails/resourceNodes/conveyors/trainRoutes/droneRoutes/mapMarkers/powerLines under their own layer name", async () => {
    const ports = fakePorts({
      getRails: vi.fn().mockResolvedValue({ data: [{ id: "r1" }], dropped: 0 }),
      getResourceNodes: vi.fn().mockResolvedValue({ data: [{ type: "Iron Ore" }], dropped: 0 }),
    });
    const ingest = { ingest: vi.fn().mockResolvedValue({ accepted: true, unchanged: false }) };
    const mapLive = { record: vi.fn() };
    const poller = new LocalWorldPoller(ports, { logger: fakeLogger(), serverPublicId: "srv-1", ingest, mapLive, jitter: () => 0.5 });
    poller.start();
    await vi.waitFor(() => expect(ingest.ingest).toHaveBeenCalledTimes(7));
    const layers = ingest.ingest.mock.calls.map((call) => call[1]);
    expect(layers.sort()).toEqual(["conveyors", "droneRoutes", "mapMarkers", "powerLines", "rails", "resourceNodes", "trainRoutes"]);
    await poller.stop();
  });

  it("records mapLive from getTrains + getTrainStations together", async () => {
    const ports = fakePorts({
      getTrains: vi.fn().mockResolvedValue({ data: [{ id: "t1" }], dropped: 0 }),
      getTrainStations: vi.fn().mockResolvedValue({ data: [{ id: "s1" }], dropped: 0 }),
    });
    const ingest = { ingest: vi.fn().mockResolvedValue({ accepted: true, unchanged: false }) };
    const mapLive = { record: vi.fn() };
    const poller = new LocalWorldPoller(ports, { logger: fakeLogger(), serverPublicId: "srv-1", ingest, mapLive, jitter: () => 0.5 });
    poller.start();
    await vi.waitFor(() => expect(mapLive.record).toHaveBeenCalledWith({ trains: [{ id: "t1" }], stations: [{ id: "s1" }] }, expect.any(Number)));
    await poller.stop();
  });

  it("logs the game-adapter mapper's own dropped count at warn, labeled by layer and server id", async () => {
    const ports = fakePorts({ getRails: vi.fn().mockResolvedValue({ data: [], dropped: 3 }) });
    const ingest = { ingest: vi.fn().mockResolvedValue({ accepted: true, unchanged: false }) };
    const logger = fakeLogger();
    const poller = new LocalWorldPoller(ports, { logger, serverPublicId: "srv-1", ingest, mapLive: { record: vi.fn() }, jitter: () => 0.5 });
    poller.start();
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ layer: "rails", serverId: "srv-1", dropped: 3 }), expect.any(String)));
    await poller.stop();
  });

  it("never logs at warn when nothing was dropped", async () => {
    const ports = fakePorts();
    const ingest = { ingest: vi.fn().mockResolvedValue({ accepted: true, unchanged: false }) };
    const logger = fakeLogger();
    const poller = new LocalWorldPoller(ports, { logger, serverPublicId: "srv-1", ingest, mapLive: { record: vi.fn() }, jitter: () => 0.5 });
    poller.start();
    await vi.waitFor(() => expect(ingest.ingest).toHaveBeenCalled());
    expect(logger.warn).not.toHaveBeenCalled();
    await poller.stop();
  });

  it("ingests the droneRoutes layer as read and warns on dropped ports", async () => {
    const ports = [{ id: "d1", name: "FUEL 5", paired: "TestLand1", input: [], output: [], fuel: [], x: 0, y: 0 }];
    const fakes = fakePorts({ getDroneRoutes: vi.fn().mockResolvedValue({ data: ports, dropped: 2 }) });
    const ingest = { ingest: vi.fn().mockResolvedValue({ accepted: true, unchanged: false }) };
    const logger = fakeLogger();
    const poller = new LocalWorldPoller(fakes, { logger, serverPublicId: "srv-1", ingest, mapLive: { record: vi.fn() }, jitter: () => 0.5 });
    poller.start();
    await vi.waitFor(() => expect(ingest.ingest).toHaveBeenCalledWith("srv-1", "droneRoutes", { observedAt: expect.any(String), data: ports }));
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ layer: "droneRoutes", dropped: 2 }), expect.any(String));
    await poller.stop();
  });

  it("ingests the mapMarkers layer as read and warns with a dropped count, never a marker's name", async () => {
    const markers = [{ id: "m1", name: "Motor and Automated wiring", kind: "marker", icon: 349, color: "#6ea37b", x: 610, y: -638 }];
    const fakes = fakePorts({ getMapMarkers: vi.fn().mockResolvedValue({ data: markers, dropped: 1 }) });
    const ingest = { ingest: vi.fn().mockResolvedValue({ accepted: true, unchanged: false }) };
    const logger = fakeLogger();
    const poller = new LocalWorldPoller(fakes, { logger, serverPublicId: "srv-1", ingest, mapLive: { record: vi.fn() }, jitter: () => 0.5 });
    poller.start();
    await vi.waitFor(() => expect(ingest.ingest).toHaveBeenCalledWith("srv-1", "mapMarkers", { observedAt: expect.any(String), data: markers }));
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ layer: "mapMarkers", dropped: 1 }), expect.any(String));
    const logged = JSON.stringify([...vi.mocked(logger.warn).mock.calls, ...vi.mocked(logger.info).mock.calls, ...vi.mocked(logger.error).mock.calls]);
    expect(logged).not.toContain(markers[0]!.name);
    await poller.stop();
  });

  it("reads mapMarkers on its own interval option, 10 min by default", async () => {
    vi.useFakeTimers();
    try {
      const fakes = fakePorts();
      const ingest = { ingest: vi.fn().mockResolvedValue({ accepted: true, unchanged: false }) };
      const poller = new LocalWorldPoller(fakes, { logger: fakeLogger(), serverPublicId: "srv-1", ingest, mapLive: { record: vi.fn() }, jitter: () => 0.5 });
      poller.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(fakes.getMapMarkers).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(599_000);
      expect(fakes.getMapMarkers).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(fakes.getMapMarkers).toHaveBeenCalledTimes(2);
      await poller.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ingests the powerLines layer as read and warns with a dropped count", async () => {
    const lines = [{ id: "Build_PowerLine_C_2147223283", points: [[-1803, -1064], [-1804, -1066]] }];
    const fakes = fakePorts({ getPowerLines: vi.fn().mockResolvedValue({ data: lines, dropped: 2 }) });
    const ingest = { ingest: vi.fn().mockResolvedValue({ accepted: true, unchanged: false }) };
    const logger = fakeLogger();
    const poller = new LocalWorldPoller(fakes, { logger, serverPublicId: "srv-1", ingest, mapLive: { record: vi.fn() }, jitter: () => 0.5 });
    poller.start();
    await vi.waitFor(() => expect(ingest.ingest).toHaveBeenCalledWith("srv-1", "powerLines", { observedAt: expect.any(String), data: lines }));
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ layer: "powerLines", dropped: 2 }), expect.any(String));
    await poller.stop();
  });

  it("reads powerLines on its own interval option, 10 min by default", async () => {
    vi.useFakeTimers();
    try {
      const fakes = fakePorts();
      const ingest = { ingest: vi.fn().mockResolvedValue({ accepted: true, unchanged: false }) };
      const poller = new LocalWorldPoller(fakes, { logger: fakeLogger(), serverPublicId: "srv-1", ingest, mapLive: { record: vi.fn() }, jitter: () => 0.5 });
      poller.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(fakes.getPowerLines).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(599_000);
      expect(fakes.getPowerLines).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(fakes.getPowerLines).toHaveBeenCalledTimes(2);
      await poller.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("honours powerLinesIntervalSeconds", async () => {
    vi.useFakeTimers();
    try {
      const fakes = fakePorts();
      const ingest = { ingest: vi.fn().mockResolvedValue({ accepted: true, unchanged: false }) };
      const poller = new LocalWorldPoller(fakes, { logger: fakeLogger(), serverPublicId: "srv-1", ingest, mapLive: { record: vi.fn() }, jitter: () => 0.5, powerLinesIntervalSeconds: 60 });
      poller.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(fakes.getPowerLines).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(61_000);
      expect(fakes.getPowerLines).toHaveBeenCalledTimes(2);
      expect(fakes.getMapMarkers).toHaveBeenCalledTimes(1);
      await poller.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ingests the trainRoutes layer as read, on the 10 min world tier, and warns on dropped records", async () => {
    const records = [{ recordType: "station", id: "s1", name: "A ", platforms: [] }];
    const ports = fakePorts({ getTrainRoutes: vi.fn().mockResolvedValue({ data: records, dropped: 1 }) });
    const ingest = { ingest: vi.fn().mockResolvedValue({ accepted: true, unchanged: false }) };
    const logger = fakeLogger();
    const poller = new LocalWorldPoller(ports, { logger, serverPublicId: "srv-1", ingest, mapLive: { record: vi.fn() }, jitter: () => 0.5 });
    poller.start();
    await vi.waitFor(() => expect(ingest.ingest).toHaveBeenCalledWith("srv-1", "trainRoutes", { observedAt: expect.any(String), data: records }));
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ layer: "trainRoutes", dropped: 1 }), expect.any(String));
    await poller.stop();
  });

  it("ingests the conveyors layer's edges as read, on rails' schedule", async () => {
    const edges = [{ id: "b1" }];
    const ports = fakePorts({ getConveyors: vi.fn().mockResolvedValue({ data: edges, dropped: 2 }) });
    const ingest = { ingest: vi.fn().mockResolvedValue({ accepted: true, unchanged: false }) };
    const logger = fakeLogger();
    const poller = new LocalWorldPoller(ports, { logger, serverPublicId: "srv-1", ingest, mapLive: { record: vi.fn() }, jitter: () => 0.5, conveyorsIntervalSeconds: 1, railsIntervalSeconds: 1 });
    poller.start();
    await vi.waitFor(() => expect(ingest.ingest).toHaveBeenCalledWith("srv-1", "conveyors", { observedAt: expect.any(String), data: edges }));
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ layer: "conveyors", dropped: 2 }), expect.any(String));
    await poller.stop();
  });

  it("a conveyors read with `skip` ingests the skip with its reason and warns once per streak, other layers unaffected", async () => {
    vi.useFakeTimers();
    try {
      const getConveyors = vi.fn().mockResolvedValue({ data: [], dropped: 0, skip: "tooManyEdges" });
      const ports = fakePorts({ getConveyors });
      const ingest = { ingest: vi.fn().mockResolvedValue({ accepted: true, unchanged: false }) };
      const logger = fakeLogger();
      const poller = new LocalWorldPoller(ports, { logger, serverPublicId: "srv-1", ingest, mapLive: { record: vi.fn() }, jitter: () => 0.5, conveyorsIntervalSeconds: 1 });
      poller.start();
      await vi.advanceTimersByTimeAsync(3500);
      expect(getConveyors.mock.calls.length).toBeGreaterThanOrEqual(3);
      await poller.stop();
      const conveyorBodies = ingest.ingest.mock.calls.filter((call) => call[1] === "conveyors").map((call) => call[2]);
      expect(conveyorBodies.length).toBeGreaterThanOrEqual(3);
      for (const body of conveyorBodies) expect(body).toEqual({ observedAt: expect.any(String), skipped: "tooManyEdges" });
      expect(ingest.ingest.mock.calls.map((call) => call[1])).toContain("rails");
      const skips = vi.mocked(logger.warn).mock.calls.filter((call) => call[0] && (call[0] as { reason?: string }).reason === "tooManyEdges");
      expect(skips).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failing conveyors read doesn't stop rails or resourceNodes", async () => {
    const ports = fakePorts({ getConveyors: vi.fn().mockRejectedValue(new Error("upstream down")) });
    const ingest = { ingest: vi.fn().mockResolvedValue({ accepted: true, unchanged: false }) };
    const logger = fakeLogger();
    const poller = new LocalWorldPoller(ports, { logger, serverPublicId: "srv-1", ingest, mapLive: { record: vi.fn() }, jitter: () => 0.5 });
    poller.start();
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ loop: "conveyors" }), expect.any(String)));
    await vi.waitFor(() => expect(ingest.ingest.mock.calls.map((call) => call[1]).sort()).toEqual(["droneRoutes", "mapMarkers", "powerLines", "rails", "resourceNodes", "trainRoutes"]));
    await poller.stop();
  });

  it("one cadence's failure doesn't stop the others: logs once and keeps rescheduling", async () => {
    const ports = fakePorts({ getRails: vi.fn().mockRejectedValue(new Error("upstream down")) });
    const ingest = { ingest: vi.fn().mockResolvedValue({ accepted: true, unchanged: false }) };
    const logger = fakeLogger();
    const poller = new LocalWorldPoller(ports, {
      logger,
      serverPublicId: "srv-1",
      ingest,
      mapLive: { record: vi.fn() },
      jitter: () => 0.5,
      railsIntervalSeconds: 1,
    });
    poller.start();
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ loop: "rails" }), expect.any(String)));
    // resourceNodes and mapLive still ran despite rails failing.
    expect(ports.getResourceNodes).toHaveBeenCalled();
    await poller.stop();
  });

  it("stop() awaits any in-flight read and stops scheduling further ones", async () => {
    let resolveRead!: () => void;
    const ports = fakePorts({ getRails: vi.fn().mockReturnValue(new Promise<{ data: unknown[]; dropped: number }>((resolve) => (resolveRead = () => resolve(empty)))) });
    const ingest = { ingest: vi.fn().mockResolvedValue({ accepted: true, unchanged: false }) };
    const poller = new LocalWorldPoller(ports, { logger: fakeLogger(), serverPublicId: "srv-1", ingest, mapLive: { record: vi.fn() }, jitter: () => 0.5 });
    poller.start();
    await vi.waitFor(() => expect(ports.getRails).toHaveBeenCalledTimes(1)); // the read is now in flight
    const stopped = poller.stop();
    resolveRead();
    await stopped;
    expect(ports.getRails).toHaveBeenCalledTimes(1); // stop() didn't let another read start
  });
});
