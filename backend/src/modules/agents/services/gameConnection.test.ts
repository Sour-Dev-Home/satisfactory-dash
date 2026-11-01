import { describe, expect, it, vi } from "vitest";
import type { GameConnectionValues } from "../repositories/agentRepository.js";
import { GAME_READ_FUTURE_SKEW_MS, LAST_SEEN_INTERVAL_MS } from "../config.js";
import { GameConnectionStore } from "./gameConnection.js";

const AGENT = { serverUuid: "11111111-1111-4111-8111-111111111111", publicId: "alpha" };
const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function storeWith(record: (serverUuid: string, values: GameConnectionValues) => Promise<void> = async () => undefined) {
  const calls: { serverUuid: string; values: GameConnectionValues }[] = [];
  const store = new GameConnectionStore({
    record: vi.fn(async (serverUuid: string, values: GameConnectionValues) => {
      calls.push({ serverUuid, values });
      await record(serverUuid, values);
    }),
  });
  return { store, calls };
}

describe("GameConnectionStore: the memory", () => {
  it("keeps the latest values by public id, and nothing for a server never heard from", () => {
    const { store } = storeWith();
    expect(store.get("alpha")).toBeUndefined();
    store.observe(AGENT, { gameReachable: true, lastGameReadAt: iso(NOW - 1_000), modVersion: "1.4.2" }, NOW);
    expect(store.get("alpha")).toEqual({ gameReachable: true, lastGameReadAt: NOW - 1_000, modVersion: "1.4.2" });
    expect(store.get("beta")).toBeUndefined();
  });

  it("takes an unreachable snapshot's values, keeping the older last read", () => {
    const { store } = storeWith();
    store.observe(AGENT, { gameReachable: true, lastGameReadAt: iso(NOW - 1_000), modVersion: "1.4.2" }, NOW);
    store.observe(AGENT, { gameReachable: false, lastGameReadAt: iso(NOW - 1_000), modVersion: "1.4.2" }, NOW + 5_000);
    expect(store.get("alpha")).toEqual({ gameReachable: false, lastGameReadAt: NOW - 1_000, modVersion: "1.4.2" });
  });

  it("lastGameReadAt only moves forward: an older or absent one keeps the newer", () => {
    const { store } = storeWith();
    store.observe(AGENT, { gameReachable: true, lastGameReadAt: iso(NOW - 1_000) }, NOW);
    store.observe(AGENT, { gameReachable: true, lastGameReadAt: iso(NOW - 60_000) }, NOW + 5_000);
    expect(store.get("alpha")?.lastGameReadAt).toBe(NOW - 1_000);
    store.observe(AGENT, { gameReachable: false }, NOW + 10_000);
    expect(store.get("alpha")?.lastGameReadAt).toBe(NOW - 1_000);
  });

  it("ignores a lastGameReadAt further in the future than the allowed skew, and accepts one within it", () => {
    const { store } = storeWith();
    store.observe(AGENT, { gameReachable: true, lastGameReadAt: iso(NOW + GAME_READ_FUTURE_SKEW_MS + 1) }, NOW);
    expect(store.get("alpha")?.lastGameReadAt).toBeNull();
    store.observe(AGENT, { gameReachable: true, lastGameReadAt: iso(NOW + GAME_READ_FUTURE_SKEW_MS) }, NOW);
    expect(store.get("alpha")?.lastGameReadAt).toBe(NOW + GAME_READ_FUTURE_SKEW_MS);
  });

  it("an unparseable lastGameReadAt (past the schema) is ignored without throwing or poisoning the stored one", () => {
    const { store } = storeWith();
    store.observe(AGENT, { gameReachable: true, lastGameReadAt: iso(NOW - 1_000) }, NOW);
    expect(() => store.observe(AGENT, { gameReachable: false, lastGameReadAt: "not a time" }, NOW + 1_000)).not.toThrow();
    expect(store.get("alpha")).toEqual({ gameReachable: false, lastGameReadAt: NOW - 1_000, modVersion: null });
  });

  it("parses an offset time to the same instant", () => {
    const { store } = storeWith();
    store.observe(AGENT, { gameReachable: true, lastGameReadAt: "2026-10-27T13:59:59+02:00" }, NOW);
    expect(store.get("alpha")?.lastGameReadAt).toBe(NOW - 1_000);
  });

  it("an older agent's snapshot (none of the fields) reads as not reported, not as the previous agent's values", () => {
    const { store } = storeWith();
    store.observe(AGENT, { gameReachable: true, lastGameReadAt: iso(NOW - 1_000), modVersion: "1.4.2" }, NOW);
    store.observe(AGENT, {}, NOW + 5_000);
    expect(store.get("alpha")).toEqual({ gameReachable: null, lastGameReadAt: NOW - 1_000, modVersion: null });
  });
});

describe("GameConnectionStore: the database copy (the agent version's pattern)", () => {
  it("writes the first snapshot, then only a change", async () => {
    const { store, calls } = storeWith();
    const readAt = iso(NOW - 1_000);
    store.observe(AGENT, { gameReachable: true, lastGameReadAt: readAt, modVersion: "1.4.2" }, NOW);
    store.observe(AGENT, { gameReachable: true, lastGameReadAt: readAt, modVersion: "1.4.2" }, NOW + 5_000);
    await store.settled();
    expect(calls).toEqual([{ serverUuid: AGENT.serverUuid, values: { gameReachable: true, lastGameReadAt: new Date(NOW - 1_000), modVersion: "1.4.2" } }]);
    store.observe(AGENT, { gameReachable: false, lastGameReadAt: readAt, modVersion: "1.4.2" }, NOW + 10_000);
    store.observe(AGENT, { gameReachable: false, lastGameReadAt: readAt, modVersion: "1.5.0" }, NOW + 15_000);
    store.observe(AGENT, { lastGameReadAt: readAt, modVersion: "1.5.0" }, NOW + 20_000);
    await store.settled();
    expect(calls.map((c) => [c.values.gameReachable, c.values.modVersion])).toEqual([
      [true, "1.4.2"],
      [false, "1.4.2"],
      [false, "1.5.0"],
      [null, "1.5.0"],
    ]);
  });

  it("a lastGameReadAt that only moved forward is written once it is the write interval past the last written one", async () => {
    const { store, calls } = storeWith();
    store.observe(AGENT, { gameReachable: true, lastGameReadAt: iso(NOW) }, NOW);
    for (let s = 5_000; s < LAST_SEEN_INTERVAL_MS; s += 5_000) store.observe(AGENT, { gameReachable: true, lastGameReadAt: iso(NOW + s) }, NOW + s);
    await store.settled();
    expect(calls).toHaveLength(1);
    expect(store.get("alpha")?.lastGameReadAt).toBe(NOW + 25_000); // the memory is always current
    store.observe(AGENT, { gameReachable: true, lastGameReadAt: iso(NOW + LAST_SEEN_INTERVAL_MS) }, NOW + LAST_SEEN_INTERVAL_MS);
    await store.settled();
    expect(calls.map((c) => c.values.lastGameReadAt)).toEqual([new Date(NOW), new Date(NOW + LAST_SEEN_INTERVAL_MS)]);
  });

  it("the first read after none is written at once", async () => {
    const { store, calls } = storeWith();
    store.observe(AGENT, { gameReachable: false }, NOW);
    store.observe(AGENT, { gameReachable: false, lastGameReadAt: iso(NOW + 1_000) }, NOW + 5_000);
    await store.settled();
    expect(calls.map((c) => c.values.lastGameReadAt)).toEqual([null, new Date(NOW + 1_000)]);
  });

  it("a failed write is retried by the next snapshot, even with the same values", async () => {
    let fail = true;
    const { store, calls } = storeWith(async () => {
      if (fail) throw new Error("database down");
    });
    const same = { gameReachable: true, modVersion: "1.4.2" };
    store.observe(AGENT, same, NOW);
    await store.settled();
    fail = false;
    store.observe(AGENT, same, NOW + 5_000);
    store.observe(AGENT, same, NOW + 10_000);
    await store.settled();
    expect(calls).toHaveLength(2);
  });

  it("writes one server's changes in order, one after another", async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { store } = storeWith(async (_uuid, values) => {
      if (values.gameReachable === true) await gate;
      order.push(String(values.gameReachable));
    });
    store.observe(AGENT, { gameReachable: true }, NOW);
    store.observe(AGENT, { gameReachable: false }, NOW + 5_000);
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    await store.settled();
    expect(order).toEqual(["true", "false"]);
  });

  it("keeps servers apart", async () => {
    const { store, calls } = storeWith();
    store.observe(AGENT, { gameReachable: true }, NOW);
    store.observe({ serverUuid: "22222222-2222-4222-8222-222222222222", publicId: "beta" }, { gameReachable: true }, NOW);
    await store.settled();
    expect(calls.map((c) => c.serverUuid)).toEqual([AGENT.serverUuid, "22222222-2222-4222-8222-222222222222"]);
    expect(store.get("beta")?.gameReachable).toBe(true);
  });
});
