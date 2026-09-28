import { describe, expect, it } from "vitest";
import { MapLiveStore } from "./mapLiveStore.js";

const validTrain = { id: "t1", name: "Train", x: 1, y: 2, status: "Self-Driving" };
const validStation = { id: "s1", name: "Station", x: 3, y: 4 };

describe("MapLiveStore", () => {
  it("has no reading for a server that has never recorded one", () => {
    expect(new MapLiveStore().latest("srv-1")).toBeUndefined();
  });

  it("records and returns the latest reading for a server", () => {
    const store = new MapLiveStore();
    store.record("srv-1", { trains: [validTrain], stations: [validStation] }, 1_000);
    expect(store.latest("srv-1")).toEqual({ data: { trains: [validTrain], stations: [validStation] }, observedAtMs: 1_000 });
  });

  it("a later record replaces the earlier one (latest only)", () => {
    const store = new MapLiveStore();
    store.record("srv-1", { trains: [validTrain], stations: [] }, 1_000);
    store.record("srv-1", { trains: [], stations: [] }, 2_000);
    expect(store.latest("srv-1")).toEqual({ data: { trains: [], stations: [] }, observedAtMs: 2_000 });
  });

  it("sinkFor binds a server id, so its record() never needs one at call time", () => {
    const store = new MapLiveStore();
    store.sinkFor("srv-1").record({ trains: [validTrain], stations: [] }, 5_000);
    expect(store.latest("srv-1")?.observedAtMs).toBe(5_000);
    expect(store.latest("srv-2")).toBeUndefined();
  });

  it("forget removes a server's reading", () => {
    const store = new MapLiveStore();
    store.record("srv-1", { trains: [], stations: [] }, 1_000);
    store.forget("srv-1");
    expect(store.latest("srv-1")).toBeUndefined();
  });

  describe("conform, don't reject (test-hunter, PR #374): a bad item is dropped, never the whole reading", () => {
    it("drops a train whose name is over MapTrainSchema's 200-char bound, keeping the rest of the reading", () => {
      const store = new MapLiveStore();
      const overlong = { ...validTrain, id: "bad", name: "x".repeat(300) };
      store.record("srv-1", { trains: [validTrain, overlong], stations: [validStation] }, 1_000);
      expect(store.latest("srv-1")?.data).toEqual({ trains: [validTrain], stations: [validStation] });
    });

    it("drops a station whose name is over the bound the same way", () => {
      const store = new MapLiveStore();
      const overlong = { ...validStation, id: "bad", name: "x".repeat(300) };
      store.record("srv-1", { trains: [], stations: [validStation, overlong] }, 1_000);
      expect(store.latest("srv-1")?.data.stations).toEqual([validStation]);
    });

    it("a reading that is ALL bad items still records cleanly as empty arrays, not a thrown error", () => {
      const store = new MapLiveStore();
      const overlong = { ...validTrain, name: "x".repeat(300) };
      expect(() => store.record("srv-1", { trains: [overlong], stations: [] }, 1_000)).not.toThrow();
      expect(store.latest("srv-1")?.data).toEqual({ trains: [], stations: [] });
    });

    it("caps the stored arrays at MAP_LIVE_MAX_TRAINS/MAP_LIVE_MAX_STATIONS even if the caller didn't", () => {
      const store = new MapLiveStore();
      const many = Array.from({ length: 2_001 }, (_, i) => ({ ...validTrain, id: `t${i}` }));
      store.record("srv-1", { trains: many, stations: [] }, 1_000);
      expect(store.latest("srv-1")?.data.trains).toHaveLength(2_000);
    });
  });
});
