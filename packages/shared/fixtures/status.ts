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

/**
 * SYNTHETIC (no capture): the server is up but no save is loaded (isGameRunning false, per
 * dedicated-server-api.md:386, "waiting for the session to be created"). What
 * QueryServerState returns for the other fields in that state is [NEEDS VERIFICATION]:
 * the empty session name, zero duration and zero tick rate are placeholders, and
 * tickHealth "healthy" is a guess. Update from a real capture once one exists.
 */
export const statusNoGame = {
  serverId: "default",
  observedAt: "2026-09-22T22:25:04.000Z",
  stale: false,
  data: {
    tickHealth: "healthy",
    isGameRunning: false,
    gamePaused: false,
    sessionName: "",
    connectedPlayers: 0,
    playerLimit: 4,
    tickRate: 0,
    totalGameDurationSeconds: 0,
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
