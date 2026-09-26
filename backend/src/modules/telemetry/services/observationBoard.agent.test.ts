import { describe, expect, it } from "vitest";
import { ObservationBoard, noopObservationSink } from "./observationBoard.js";

// ADR-0031: an agent server's board also remembers when the agent was last heard.

describe("ObservationBoard for a server reached through an agent", () => {
  it("has no `agent` field on a polled server's board", () => {
    const board = new ObservationBoard();
    board.recordAgentSeen(5);
    expect(board.snapshot().agent).toBeUndefined();
    expect("agent" in board.snapshot()).toBe(false);
  });

  it("starts with the board's own start time and nothing heard", () => {
    expect(new ObservationBoard({ agentStartedAt: 1000 }).snapshot().agent).toEqual({ startedAt: 1000, lastHeardAt: undefined });
  });

  it("remembers the newest arrival, and never moves backwards on a late or retried snapshot", () => {
    const board = new ObservationBoard({ agentStartedAt: 1000 });
    board.recordAgentSeen(2000);
    board.recordAgentSeen(5000);
    board.recordAgentSeen(3000);
    expect(board.snapshot().agent).toEqual({ startedAt: 1000, lastHeardAt: 5000 });
  });

  it("is independent of the poll health the game-unreachable rule reads", () => {
    const board = new ObservationBoard({ agentStartedAt: 0 });
    board.recordAgentSeen(10);
    expect(board.snapshot().polls).toEqual({ consecutiveFailures: 0, firstFailureAt: undefined, lastSuccessAt: undefined });
  });

  it("the no-op sink accepts it too (a server without a database)", () => {
    expect(() => noopObservationSink.recordAgentSeen(1)).not.toThrow();
  });
});
