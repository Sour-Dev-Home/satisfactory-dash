import type { StatusResponse } from "../src/index";

// Values from the 2026-09-22 captures (docs-vault/raw-sources/captured-responses/
// vanilla-QueryServerState-2026-09-22-*.json). Session name is the capture's placeholder.

/** 01-running: auto-pause off, no players, simulation running. */
export const statusRunning = {
  serverId: "default",
  observedAt: "2026-09-22T22:25:04.000Z",
  stale: false,
  data: {
    tickHealth: "healthy",
    isGameRunning: true,
    gamePaused: false,
    sessionName: "ExampleSession",
    connectedPlayers: 0,
    playerLimit: 4,
    tickRate: 21.415126800537109,
    totalGameDurationSeconds: 96654,
  },
} satisfies StatusResponse;

/** 00-paused: auto-pause on, no players, so the simulation is paused and values are frozen. */
export const statusPaused = {
  serverId: "default",
  observedAt: "2026-09-22T22:16:00.000Z",
  stale: false,
  data: {
    ...statusRunning.data,
    gamePaused: true,
    tickRate: 21.814037322998047,
    totalGameDurationSeconds: 96589,
  },
} satisfies StatusResponse;

/** SYNTHETIC: tick rate below 10/s. */
export const statusSlow = {
  ...statusRunning,
  data: { ...statusRunning.data, tickHealth: "slow", tickRate: 8.2 },
} satisfies StatusResponse;

export const statusStale = {
  ...statusRunning,
  observedAt: "2026-09-22T22:20:00.000Z",
  stale: true,
} satisfies StatusResponse;
