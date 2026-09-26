import { describe, expect, it } from "vitest";
import { noopObservationSink, ObservationBoard } from "./observationBoard.js";

// ADR-0027 (alerts): what the pollers last saw, in memory, per server.
describe("ObservationBoard", () => {
  it("starts empty: nothing observed, no failures, no success", () => {
    expect(new ObservationBoard().snapshot()).toEqual({
      session: undefined,
      status: undefined,
      power: undefined,
      factory: undefined,
      polls: { consecutiveFailures: 0, firstFailureAt: undefined, lastSuccessAt: undefined },
    });
  });

  it("keeps the last status, power and factory readings with their own timestamps and intervals", () => {
    const board = new ObservationBoard();
    board.publishStatus({ observedAt: 100, intervalMs: 5000, paused: false, session: "S1" });
    board.publishPower({ observedAt: 100, intervalMs: 5000, circuits: [{ circuit: 1, status: "ok", fuseTripped: false }] });
    board.publishFactory({ observedAt: 90, intervalMs: 30_000, afterResume: true, machines: [], itemRates: new Map([["Desc_IronPlate_C", 60]]) });
    board.publishStatus({ observedAt: 105, intervalMs: 5000, paused: true, session: "S2" });
    const snapshot = board.snapshot();
    expect(snapshot.session).toBe("S2");
    expect(snapshot.status).toEqual({ observedAt: 105, intervalMs: 5000, paused: true });
    expect(snapshot.power?.circuits).toEqual([{ circuit: 1, status: "ok", fuseTripped: false }]);
    expect(snapshot.factory).toMatchObject({ observedAt: 90, intervalMs: 30_000, afterResume: true });
  });

  it("counts consecutive failures from the FIRST one, and a success resets them", () => {
    const board = new ObservationBoard();
    board.recordPollFailure(1000);
    board.recordPollFailure(6000);
    board.recordPollFailure(11_000);
    expect(board.snapshot().polls).toEqual({ consecutiveFailures: 3, firstFailureAt: 1000, lastSuccessAt: undefined });
    board.recordPollSuccess(16_000);
    expect(board.snapshot().polls).toEqual({ consecutiveFailures: 0, firstFailureAt: undefined, lastSuccessAt: 16_000 });
    board.recordPollFailure(20_000);
    expect(board.snapshot().polls).toMatchObject({ consecutiveFailures: 1, firstFailureAt: 20_000, lastSuccessAt: 16_000 });
  });

  it("a snapshot is a view: readings replaced later do not change one already taken", () => {
    const board = new ObservationBoard();
    board.publishPower({ observedAt: 1, intervalMs: 5000, circuits: [] });
    const before = board.snapshot();
    board.publishPower({ observedAt: 2, intervalMs: 5000, circuits: [{ circuit: 9, status: "outage", fuseTripped: true }] });
    expect(before.power?.observedAt).toBe(1);
    expect(before.power?.circuits).toEqual([]);
  });

  it("the no-op sink accepts everything and keeps nothing", () => {
    expect(() => {
      noopObservationSink.publishStatus({ observedAt: 1, intervalMs: 1, paused: false, session: "S" });
      noopObservationSink.publishPower({ observedAt: 1, intervalMs: 1, circuits: [] });
      noopObservationSink.publishFactory({ observedAt: 1, intervalMs: 1, afterResume: false, machines: [], itemRates: new Map() });
      noopObservationSink.recordPollFailure(1);
      noopObservationSink.recordPollSuccess(1);
    }).not.toThrow();
  });
});
