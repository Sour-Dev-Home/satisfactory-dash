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
    getTrains: vi.fn().mockResolvedValue(empty),
    getTrainStations: vi.fn().mockResolvedValue(empty),
    ...overrides,
  };
}

describe("LocalWorldPoller", () => {
  it("reads rails, resourceNodes and mapLive immediately on start, each once", async () => {
    const ports = fakePorts();
    const ingest = { ingest: vi.fn().mockResolvedValue({ accepted: true, unchanged: false }) };
    const mapLive = { record: vi.fn() };
    const poller = new LocalWorldPoller(ports, { logger: fakeLogger(), serverPublicId: "srv-1", ingest, mapLive, jitter: () => 0.5 });
    poller.start();
    await vi.waitFor(() => expect(ports.getRails).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(ports.getResourceNodes).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(mapLive.record).toHaveBeenCalledTimes(1));
    await poller.stop();
  });

  it("ingests rails/resourceNodes under their own layer name", async () => {
    const ports = fakePorts({
      getRails: vi.fn().mockResolvedValue({ data: [{ id: "r1" }], dropped: 0 }),
      getResourceNodes: vi.fn().mockResolvedValue({ data: [{ type: "Iron Ore" }], dropped: 0 }),
    });
    const ingest = { ingest: vi.fn().mockResolvedValue({ accepted: true, unchanged: false }) };
    const mapLive = { record: vi.fn() };
    const poller = new LocalWorldPoller(ports, { logger: fakeLogger(), serverPublicId: "srv-1", ingest, mapLive, jitter: () => 0.5 });
    poller.start();
    await vi.waitFor(() => expect(ingest.ingest).toHaveBeenCalledTimes(2));
    const layers = ingest.ingest.mock.calls.map((call) => call[1]);
    expect(layers.sort()).toEqual(["rails", "resourceNodes"]);
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
