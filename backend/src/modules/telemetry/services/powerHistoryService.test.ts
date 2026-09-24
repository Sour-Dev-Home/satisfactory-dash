import { describe, it, expect } from "vitest";
import { PowerHistoryService, STALE_AFTER_INTERVALS } from "./powerHistoryService.js";
import type { PollerHealth } from "./powerHistoryPoller.js";
import { InMemoryPowerHistoryStore } from "./powerHistoryStore.js";

const T0 = 1_700_000_000_000;
const INTERVAL_MS = 5000;

function setup(health: { startedAt?: number; lastSuccessAt?: number }, nowMs: number) {
  const store = new InMemoryPowerHistoryStore();
  store.append({
    t: T0,
    gamePaused: false,
    circuits: [{ circuitGroupId: 0, productionMW: 1, consumptionMW: 1, capacityMW: 1, batteryPercent: 0, fuseTriggered: false }],
  });
  const pollerHealth: PollerHealth = { startedAt: () => health.startedAt, lastSuccessAt: () => health.lastSuccessAt };
  return new PowerHistoryService(store, pollerHealth, { now: () => nowMs });
}

describe("PowerHistoryService", () => {
  it("is stale after 3 intervals, as ADR-0022 says", () => {
    expect(STALE_AFTER_INTERVALS).toBe(3);
  });

  it("is fresh right after a successful poll, and observedAt is that poll's time", () => {
    const result = setup({ startedAt: T0 - 60_000, lastSuccessAt: T0 }, T0 + 1000).getPowerHistory();
    expect(result.stale).toBe(false);
    expect(result.observedAt).toBe(new Date(T0).toISOString());
    expect(result.data.series).toHaveLength(1);
  });

  it("is fresh at exactly 3 intervals and stale just past it", () => {
    expect(setup({ lastSuccessAt: T0 }, T0 + 3 * INTERVAL_MS).getPowerHistory().stale).toBe(false);
    expect(setup({ lastSuccessAt: T0 }, T0 + 3 * INTERVAL_MS + 1).getPowerHistory().stale).toBe(true);
  });

  it("stays fresh through one or two missed polls (a blip is not an outage)", () => {
    expect(setup({ lastSuccessAt: T0 }, T0 + 2 * INTERVAL_MS).getPowerHistory().stale).toBe(false);
  });

  it("keeps serving the old data while stale, and reports when it was last really read", () => {
    const result = setup({ lastSuccessAt: T0 }, T0 + 10 * 60_000).getPowerHistory();
    expect(result.stale).toBe(true);
    expect(result.observedAt).toBe(new Date(T0).toISOString());
    expect(result.data.pausedRanges).toEqual([]);
  });

  it("before the first success, measures from when polling started", () => {
    expect(setup({ startedAt: T0 }, T0 + 2 * INTERVAL_MS).getPowerHistory().stale).toBe(false);
    expect(setup({ startedAt: T0 }, T0 + 4 * INTERVAL_MS).getPowerHistory().stale).toBe(true);
  });

  it("is stale, with observedAt of now, when nothing is polling at all", () => {
    const result = setup({}, T0 + 1000).getPowerHistory();
    expect(result.stale).toBe(true);
    expect(result.observedAt).toBe(new Date(T0 + 1000).toISOString());
  });

  it("uses the configured interval for the stale threshold", () => {
    const store = new InMemoryPowerHistoryStore({ windowSeconds: 60, intervalSeconds: 2 });
    const service = new PowerHistoryService(store, { startedAt: () => T0, lastSuccessAt: () => T0 }, {
      intervalSeconds: 2,
      now: () => T0 + 7000,
    });
    expect(service.getPowerHistory().stale).toBe(true); // 7 s > 3 x 2 s
    expect(service.getPowerHistory().data.windowSeconds).toBe(60);
  });
});
