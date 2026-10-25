import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { LatestSnapshotStore } from "./agentSnapshotStore.js";
import { LatestSnapshotWriter } from "./latestSnapshotWriter.js";
import type { LatestSnapshotRepository, LatestSnapshotWrite } from "../repositories/latestSnapshotRepository.js";

const CADENCE = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };
const T0 = Date.parse("2026-10-24T10:00:00.000Z");
const FIVE_MIN = 5 * 60 * 1000;

describe("LatestSnapshotWriter edge cases (fresh-eyes review)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function build(repo: LatestSnapshotRepository, ready?: Promise<string | undefined>) {
    const store = new LatestSnapshotStore(() => CADENCE, () => Date.now());
    const warn = vi.fn();
    const logger = { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
    const writer = new LatestSnapshotWriter(store, repo, "srv", { logger, ready });
    writer.start();
    return { store, writer, warn };
  }
  const rec = (store: LatestSnapshotStore, at: number, reachable = true) =>
    store.record({ reachable, observedAtMs: at, receivedAtMs: at, ...(reachable ? { status: { sessionName: "s" } as never } : {}) });

  it("folds reachability changes that land during a slow write into one extra write", async () => {
    const writes: LatestSnapshotWrite[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let first = true;
    const repo: LatestSnapshotRepository = {
      load: vi.fn(async () => undefined),
      upsert: vi.fn(async (_id, w) => {
        writes.push(w);
        if (first) {
          first = false;
          await gate;
        }
      }),
    };
    const { store, writer } = build(repo);
    rec(store, T0);
    await vi.advanceTimersByTimeAsync(0);
    rec(store, T0 + 1000, false);
    rec(store, T0 + 2000, true);
    rec(store, T0 + 3000, false);
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({ reachable: false });
    await writer.stop();
  });

  it("a failed first write is retried at the next tick", async () => {
    const writes: LatestSnapshotWrite[] = [];
    let fail = true;
    const repo: LatestSnapshotRepository = {
      load: vi.fn(async () => undefined),
      upsert: vi.fn(async (_id, w) => {
        if (fail) throw new Error("db down");
        writes.push(w);
      }),
    };
    const { store, writer, warn } = build(repo);
    rec(store, T0);
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledTimes(1);
    fail = false;
    await vi.advanceTimersByTimeAsync(FIVE_MIN);
    expect(writes).toHaveLength(1);
    await writer.stop();
  });

  it("stop() before the startup load settled does not write a partial state over the row", async () => {
    const writes: LatestSnapshotWrite[] = [];
    const repo: LatestSnapshotRepository = { load: vi.fn(async () => undefined), upsert: vi.fn(async (_id, w) => void writes.push(w)) };
    let settle!: (k: string | undefined) => void;
    const ready = new Promise<string | undefined>((r) => (settle = r));
    const { store, writer } = build(repo, ready);
    rec(store, T0); // a snapshot arrived, but the restored parts are not merged in yet
    const stopping = writer.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(0);
    settle(undefined);
    await stopping;
  });

  it("stop() resolves, and does not reject, when reading the state throws", async () => {
    const repo: LatestSnapshotRepository = { load: vi.fn(async () => undefined), upsert: vi.fn(async () => undefined) };
    const { store, writer } = build(repo);
    vi.spyOn(store, "persistedState").mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(writer.stop()).resolves.toBeUndefined();
  });

  it("an interval tick whose write throws raises no unhandled rejection", async () => {
    const repo: LatestSnapshotRepository = { load: vi.fn(async () => undefined), upsert: vi.fn(async () => undefined) };
    const { store, writer } = build(repo);
    vi.spyOn(store, "persistedState").mockImplementation(() => {
      throw new Error("boom");
    });
    const seen = vi.fn();
    process.on("unhandledRejection", seen);
    await vi.advanceTimersByTimeAsync(FIVE_MIN);
    await vi.advanceTimersByTimeAsync(0);
    process.off("unhandledRejection", seen);
    expect(seen).not.toHaveBeenCalled();
    await writer.stop();
  });
});
