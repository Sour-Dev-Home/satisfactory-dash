import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { LatestSnapshotStore } from "./agentSnapshotStore.js";
import { LATEST_FACTORY_MAX_BYTES, LatestSnapshotWriter, loadLatestSnapshot } from "./latestSnapshotWriter.js";
import type { LatestSnapshotRepository, LatestSnapshotRow, LatestSnapshotWrite } from "../repositories/latestSnapshotRepository.js";

const CADENCE = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };
const T0 = Date.parse("2026-10-24T10:00:00.000Z");
const FIVE_MIN = 5 * 60 * 1000;
const STATUS = { tickHealth: "healthy", isGameRunning: true, gamePaused: false, sessionName: "old", connectedPlayers: 1, playerLimit: 4, tickRate: 30, totalGameDurationSeconds: 10 };

function fakeRepo(overrides: Partial<LatestSnapshotRepository> = {}) {
  const writes: LatestSnapshotWrite[] = [];
  const repo: LatestSnapshotRepository = {
    load: vi.fn(async () => undefined),
    upsert: vi.fn(async (_id, w) => {
      writes.push(w);
    }),
    ...overrides,
  };
  return { repo, writes };
}

function fakeLogger() {
  const warn = vi.fn();
  return { logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger, warn };
}

describe("LatestSnapshotWriter (ADR-0052 2.3)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const record = (store: LatestSnapshotStore, at: number, extra: Record<string, unknown> = {}) =>
    store.record({ reachable: true, observedAtMs: at, receivedAtMs: at, status: { sessionName: "s" } as never, ...extra });

  function setup(overrides: Partial<LatestSnapshotRepository> = {}, options: { ready?: Promise<string | undefined> } = {}) {
    const store = new LatestSnapshotStore(() => CADENCE, () => Date.now());
    const { repo, writes } = fakeRepo(overrides);
    const { logger, warn } = fakeLogger();
    const writer = new LatestSnapshotWriter(store, repo, "srv", { logger, ...options });
    writer.start();
    return { store, repo, writes, warn, writer };
  }

  it("writes nothing while nothing changed, and nothing before any snapshot", async () => {
    const { writes, writer } = setup();
    await vi.advanceTimersByTimeAsync(FIVE_MIN * 3);
    expect(writes).toHaveLength(0);
    await writer.stop();
    expect(writes).toHaveLength(0);
  });

  it("writes at most once in 5 minutes however often readings arrive, and only if a reading moved", async () => {
    const { store, writes, writer } = setup();
    record(store, T0 + 1000);
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 1; i <= 50; i++) record(store, T0 + 1000 + i * 5000);
    await vi.advanceTimersByTimeAsync(FIVE_MIN - 1);
    expect(writes).toHaveLength(1); // the first snapshot changed reachability (unknown -> reachable): written at once
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toHaveLength(2);
    expect(writes[1]!.statusObservedAtMs).toBe(T0 + 1000 + 50 * 5000);
    await vi.advanceTimersByTimeAsync(FIVE_MIN * 2); // nothing moved
    expect(writes).toHaveLength(2);
    await writer.stop();
  });

  it("writes at once on each reachability change, keeping the last parts and the outage start", async () => {
    const { store, writes, writer } = setup();
    record(store, T0, { power: { circuits: [] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(1);
    store.record({ reachable: false, observedAtMs: T0 + 5000, receivedAtMs: T0 + 5000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({ reachable: false, unreachableSinceMs: T0 + 5000, statusObservedAtMs: T0 });
    expect(writes[1]!.powerJson).not.toBeNull();
    store.record({ reachable: false, observedAtMs: T0 + 10_000, receivedAtMs: T0 + 10_000 }); // same state: no write
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(2);
    record(store, T0 + 15_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(3);
    expect(writes[2]).toMatchObject({ reachable: true, unreachableSinceMs: undefined });
    await writer.stop();
  });

  it("flushes once on stop when something changed, and not when nothing did", async () => {
    const { store, writes, writer } = setup();
    record(store, T0);
    await vi.advanceTimersByTimeAsync(0);
    record(store, T0 + 5000);
    expect(writes).toHaveLength(1);
    await writer.stop();
    expect(writes).toHaveLength(2);
    expect(writes[1]!.statusObservedAtMs).toBe(T0 + 5000);
    await writer.stop();
    expect(writes).toHaveLength(2);
  });

  it("gives up on a stuck final flush after 2 seconds", async () => {
    const never = new Promise<void>(() => {});
    const { store, writer } = setup({ upsert: vi.fn(() => never) });
    record(store, T0);
    const stopped = writer.stop();
    let done = false;
    void stopped.then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stopped;
    expect(done).toBe(true);
  });

  it("logs a failed write once per attempt and retries at the next tick", async () => {
    let fail = true;
    const upsert = vi.fn(async () => {
      if (fail) throw new Error("db down");
    });
    const { store, warn, writer } = setup({ upsert });
    record(store, T0);
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledTimes(1);
    fail = false;
    await vi.advanceTimersByTimeAsync(FIVE_MIN);
    expect(upsert).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(FIVE_MIN);
    expect(upsert).toHaveBeenCalledTimes(2);
    await writer.stop();
  });

  it("never writes players", async () => {
    const { store, writes, writer } = setup();
    record(store, T0, { players: { available: true, players: [{ name: "Secret" }] } });
    await vi.advanceTimersByTimeAsync(0);
    await writer.stop();
    expect(JSON.stringify(writes)).not.toContain("Secret");
  });

  it("writes a factory over the cap as NULL with one warning per crossing, never truncated", async () => {
    const { store, writes, warn, writer } = setup();
    const big = { buildings: ["x".repeat(LATEST_FACTORY_MAX_BYTES)] } as never;
    const small = { buildings: [] } as never;
    record(store, T0, { factory: big });
    await vi.advanceTimersByTimeAsync(0);
    expect(writes[0]).toMatchObject({ factoryJson: null, factoryObservedAtMs: undefined });
    expect(writes[0]!.statusJson).not.toBeNull();
    record(store, T0 + 30_000, { factory: big });
    await vi.advanceTimersByTimeAsync(FIVE_MIN);
    expect(writes).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatchObject({ bytes: expect.any(Number) });
    record(store, T0 + 60_000, { factory: small });
    await vi.advanceTimersByTimeAsync(FIVE_MIN);
    expect(writes[2]!.factoryJson).toBe(JSON.stringify(small));
    record(store, T0 + 90_000, { factory: big }); // a second crossing warns again
    await vi.advanceTimersByTimeAsync(FIVE_MIN);
    expect(warn).toHaveBeenCalledTimes(2);
    await writer.stop();
  });

  it("stores a factory exactly at the cap", async () => {
    const { store, writes, writer } = setup();
    const overhead = Buffer.byteLength(JSON.stringify({ b: "" }));
    record(store, T0, { factory: { b: "x".repeat(LATEST_FACTORY_MAX_BYTES - overhead) } as never });
    await vi.advanceTimersByTimeAsync(0);
    expect(writes[0]!.factoryJson).not.toBeNull();
    await writer.stop();
  });

  it("waits for the startup load before its first write, and a restored, unchanged state is not rewritten", async () => {
    let release!: (key: string | undefined) => void;
    const ready = new Promise<string | undefined>((resolve) => {
      release = resolve;
    });
    const { store, writes, writer } = setup({}, { ready });
    record(store, T0);
    await vi.advanceTimersByTimeAsync(FIVE_MIN);
    expect(writes).toHaveLength(0);
    release(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(1);
    await writer.stop();
  });
});

describe("loadLatestSnapshot (ADR-0052 2.4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const row = (overrides: Partial<LatestSnapshotRow> = {}): LatestSnapshotRow => ({
    reachable: true,
    unreachableSinceMs: undefined,
    lastReceivedAtMs: T0 - 60_000,
    status: { data: STATUS, observedAtMs: T0 - 60_000 },
    power: undefined,
    factory: undefined,
    autoPause: undefined,
    ...overrides,
  });

  it("restores the row and serves it stale, whatever its age, until a newer snapshot replaces it", async () => {
    const store = new LatestSnapshotStore(() => CADENCE, () => Date.now());
    const { logger } = fakeLogger();
    const { repo } = fakeRepo({ load: vi.fn(async () => row({ status: { data: STATUS, observedAtMs: T0 - 1000 } })) });
    await loadLatestSnapshot(store, repo, "srv", logger);
    expect(store.read("status")).toMatchObject({ sessionName: "old" });
    expect(store.persistedState()?.status?.observedAtMs).toBe(T0 - 1000);
  });

  it("a restored, unchanged state is not rewritten; a new reading is", async () => {
    const store = new LatestSnapshotStore(() => CADENCE, () => Date.now());
    const { logger } = fakeLogger();
    const { repo, writes } = fakeRepo({ load: vi.fn(async () => row()) });
    const writer = new LatestSnapshotWriter(store, repo, "srv", { logger, ready: loadLatestSnapshot(store, repo, "srv", logger) });
    writer.start();
    await vi.advanceTimersByTimeAsync(FIVE_MIN * 2);
    expect(writes).toHaveLength(0);
    store.record({ reachable: true, observedAtMs: T0, receivedAtMs: T0, status: STATUS as never });
    await vi.advanceTimersByTimeAsync(FIVE_MIN);
    expect(writes).toHaveLength(1);
    await writer.stop();
  });

  it("drops a stored part that no longer fits its schema", async () => {
    const store = new LatestSnapshotStore(() => CADENCE, () => Date.now());
    const { logger } = fakeLogger();
    const { repo } = fakeRepo({ load: vi.fn(async () => row({ status: { data: { bogus: true }, observedAtMs: T0 - 1000 } })) });
    await loadLatestSnapshot(store, repo, "srv", logger);
    expect(() => store.read("status")).toThrow();
  });

  it("stops waiting after 2 seconds and treats the store as empty; a failed load warns and is also empty", async () => {
    const store = new LatestSnapshotStore(() => CADENCE, () => Date.now());
    const { logger, warn } = fakeLogger();
    const { repo } = fakeRepo({ load: vi.fn(() => new Promise<LatestSnapshotRow | undefined>(() => {})) });
    const loading = loadLatestSnapshot(store, repo, "srv", logger);
    await vi.advanceTimersByTimeAsync(2000);
    await loading;
    expect(() => store.read("status")).toThrow();

    const failing = fakeRepo({ load: vi.fn(async () => Promise.reject(new Error("down"))) }).repo;
    await loadLatestSnapshot(store, failing, "srv", logger);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
