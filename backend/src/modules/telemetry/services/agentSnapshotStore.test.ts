import { describe, expect, it } from "vitest";
import { snapshot } from "../../../platform/snapshot.js";
import { LatestSnapshotStore, type SnapshotPart } from "./agentSnapshotStore.js";

const CADENCE = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };

/** ADR-0052: an unreachable game still serves the last stored parts, stale, with when the outage began. */
describe("LatestSnapshotStore.read while the game is unreachable (ADR-0052)", () => {
  const T0 = Date.parse("2026-10-24T10:00:00.000Z");
  const status = { sessionName: "s" } as never;
  const iso = (ms: number) => new Date(ms).toISOString();
  const reachable = (store: LatestSnapshotStore, at: number) =>
    store.record({ reachable: true, observedAtMs: at, receivedAtMs: at, status, power: { circuits: [] } as never, factory: { buildings: [] } as never });
  const unreachable = (store: LatestSnapshotStore, at: number) => store.record({ reachable: false, observedAtMs: at, receivedAtMs: at });
  const markOf = (store: LatestSnapshotStore, part: SnapshotPart) => snapshot("x", store.read(part));

  it("returns the stored parts stale with the first unreachable time, even when the parts are fresh", () => {
    const store = new LatestSnapshotStore(() => CADENCE, () => T0 + 6000);
    reachable(store, T0 + 5000);
    unreachable(store, T0 + 6000);
    for (const part of ["status", "power", "factory"] as const) {
      expect(markOf(store, part)).toMatchObject({ observedAt: iso(T0 + 5000), stale: true, unreachableSince: iso(T0 + 6000) });
    }
    expect(store.read("status")).toMatchObject({ sessionName: "s" });
  });

  it("keeps the first time across a run of unreachable snapshots", () => {
    const store = new LatestSnapshotStore(() => CADENCE, () => T0 + 60_000);
    reachable(store, T0);
    unreachable(store, T0 + 5000);
    unreachable(store, T0 + 10_000);
    unreachable(store, T0 + 15_000);
    expect(markOf(store, "status").unreachableSince).toBe(iso(T0 + 5000));
  });

  it("clears it when a reachable snapshot arrives, and a later outage gets its own time", () => {
    const store = new LatestSnapshotStore(() => CADENCE, () => T0 + 11_000);
    reachable(store, T0);
    unreachable(store, T0 + 5000);
    reachable(store, T0 + 10_000);
    const back = markOf(store, "status");
    expect(back.unreachableSince).toBeUndefined();
    expect("unreachableSince" in back).toBe(false);
    expect(back.stale).toBe(false);
    unreachable(store, T0 + 20_000);
    expect(markOf(store, "status").unreachableSince).toBe(iso(T0 + 20_000));
  });

  it("still throws upstream_unreachable with no part stored: never reported, or unreachable from the first snapshot", () => {
    const empty = new LatestSnapshotStore(() => CADENCE);
    expect(() => empty.read("status")).toThrowError(expect.objectContaining({ code: "upstream_unreachable" }));
    const never = new LatestSnapshotStore(() => CADENCE);
    unreachable(never, T0);
    expect(() => never.read("status")).toThrowError(expect.objectContaining({ code: "upstream_unreachable" }));
    expect(() => never.read("players", { available: false, players: [] })).toThrowError(expect.objectContaining({ code: "upstream_unreachable" }));
  });

  it("throws for a part that was never stored while others are served (players when the agent never sent them)", () => {
    const store = new LatestSnapshotStore(() => CADENCE, () => T0 + 6000);
    reachable(store, T0 + 5000);
    unreachable(store, T0 + 6000);
    expect(() => store.read("players")).toThrowError(expect.objectContaining({ code: "upstream_unreachable" }));
  });

  it("a silent agent (no unreachable snapshot) is stale by age only, without unreachableSince", () => {
    const store = new LatestSnapshotStore(() => CADENCE, () => T0 + 60_000);
    reachable(store, T0);
    expect(markOf(store, "status")).toMatchObject({ stale: true });
    expect(markOf(store, "status").unreachableSince).toBeUndefined();
  });
});

/**
 * #368: CADENCE_KEY[part] became ownValue(CADENCE_KEY, part). `part` is never attacker-controlled
 * today (every caller passes a literal), but the guard also protects against a future SnapshotPart
 * that forgets a CADENCE_KEY entry, or a part name that collides with Object.prototype.
 */
describe("LatestSnapshotStore.read: parts outside CADENCE_KEY", () => {
  it("still reads every real part (status, power, factory, players) with its own cadence", () => {
    const store = new LatestSnapshotStore(() => CADENCE);
    store.record({ reachable: true, observedAtMs: 1, receivedAtMs: 1, status: { sessionName: "s" } as never, power: {} as never, factory: { buildings: [] } as never, players: { available: true, players: [] } as never });
    for (const part of ["status", "power", "factory", "players"] as const) {
      expect(() => store.read(part)).not.toThrow();
    }
  });

  it("throws (not a stray cadence off Object.prototype) for a part name that collides with Object.prototype", () => {
    const store = new LatestSnapshotStore(() => CADENCE);
    store.record({ reachable: true, observedAtMs: 1, receivedAtMs: 1, status: { sessionName: "s" } as never });
    // These are never real SnapshotPart values; only reachable by bypassing the type system, as a
    // future bug (a part added to StoredParts without a matching CADENCE_KEY entry) would.
    for (const bogus of ["constructor", "toString", "hasOwnProperty"]) {
      expect(() => store.read(bogus as SnapshotPart)).toThrow(/no cadence for snapshot part/);
    }
  });

  it("throws upstream_unreachable for an unrecognized part with no stored data at all", () => {
    const store = new LatestSnapshotStore(() => CADENCE);
    store.record({ reachable: true, observedAtMs: 1, receivedAtMs: 1, status: { sessionName: "s" } as never });
    expect(() => store.read("not_a_real_part" as SnapshotPart)).toThrowError(expect.objectContaining({ code: "upstream_unreachable" }));
  });
});

/** ADR-0052 2.4: a row loaded at startup is served stale, whatever its age, until a fresh snapshot replaces it. */
describe("LatestSnapshotStore.restore (ADR-0052)", () => {
  const T0 = Date.parse("2026-10-24T10:00:00.000Z");
  const restored = (over: Partial<Parameters<LatestSnapshotStore["restore"]>[0]> = {}) => ({
    reachable: true,
    unreachableSinceMs: undefined,
    lastReceivedAtMs: T0,
    status: { data: { sessionName: "old" } as never, observedAtMs: T0 },
    power: undefined,
    factory: undefined,
    autoPause: undefined,
    ...over,
  });

  it("serves restored parts stale even when they are younger than three intervals", () => {
    const store = new LatestSnapshotStore(() => CADENCE, () => T0 + 1000);
    store.restore(restored());
    expect(snapshot("x", store.read("status"))).toMatchObject({ observedAt: new Date(T0).toISOString(), stale: true });
    expect(store.lastReceivedAt()).toBe(T0);
  });

  it("a fresh snapshot replaces a restored part and the part is fresh again", () => {
    const store = new LatestSnapshotStore(() => CADENCE, () => T0 + 61_000);
    store.restore(restored());
    store.record({ reachable: true, observedAtMs: T0 + 60_000, receivedAtMs: T0 + 60_000, status: { sessionName: "new" } as never });
    expect(store.read("status")).toMatchObject({ sessionName: "new" });
    expect(snapshot("x", store.read("status")).stale).toBe(false);
  });

  it("a snapshot that arrived before the load keeps winning, and a restored part it did not carry is still served", () => {
    const store = new LatestSnapshotStore(() => CADENCE, () => T0 + 61_000);
    store.record({ reachable: true, observedAtMs: T0 + 60_000, receivedAtMs: T0 + 60_000, status: { sessionName: "new" } as never });
    store.restore(restored({ power: { data: { circuits: [] } as never, observedAtMs: T0 }, reachable: false, unreachableSinceMs: T0 }));
    expect(store.read("status")).toMatchObject({ sessionName: "new" });
    expect(snapshot("x", store.read("power")).stale).toBe(true);
    expect(snapshot("x", store.read("status")).unreachableSince).toBeUndefined(); // the live state was not overwritten
  });

  it("restores an outage with its start, and a later unreachable snapshot keeps that start", () => {
    const store = new LatestSnapshotStore(() => CADENCE, () => T0 + 20_000);
    store.restore(restored({ reachable: false, unreachableSinceMs: T0 - 5000 }));
    expect(snapshot("x", store.read("status")).unreachableSince).toBe(new Date(T0 - 5000).toISOString());
    store.record({ reachable: false, observedAtMs: T0 + 10_000, receivedAtMs: T0 + 10_000 });
    expect(snapshot("x", store.read("status")).unreachableSince).toBe(new Date(T0 - 5000).toISOString());
  });

  it("never restores players, and persistedState carries no players", () => {
    const store = new LatestSnapshotStore(() => CADENCE, () => T0);
    store.record({ reachable: true, observedAtMs: T0, receivedAtMs: T0, players: { available: true, players: [] } as never });
    expect(Object.keys(store.persistedState() ?? {})).not.toContain("players");
  });

  it("tells its listener only when reachability changes", () => {
    const store = new LatestSnapshotStore(() => CADENCE, () => T0);
    let calls = 0;
    store.onReachabilityChange(() => calls++);
    store.record({ reachable: true, observedAtMs: T0, receivedAtMs: T0 });
    store.record({ reachable: true, observedAtMs: T0 + 1, receivedAtMs: T0 + 1 });
    store.record({ reachable: false, observedAtMs: T0 + 2, receivedAtMs: T0 + 2 });
    store.record({ reachable: false, observedAtMs: T0 + 3, receivedAtMs: T0 + 3 });
    expect(calls).toBe(2);
  });
});
