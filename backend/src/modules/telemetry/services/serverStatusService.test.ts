import { describe, it, expect } from "vitest";
import { StatusSchema } from "@satisfactory-dash/shared";
import { ServerStatusService } from "./serverStatusService.js";
import type { ServerStatusAdapterLike } from "./serverStatusService.js";
import type { ServerStatus } from "../../gameserver/index.js";

const serverStatus: ServerStatus = {
  sessionName: "my-save",
  isGameRunning: true,
  isPaused: false,
  connectedPlayers: 2,
  playerLimit: 4,
  tickRate: 30,
  totalGameDurationSeconds: 100,
};

function adapterWith(overrides: Partial<ServerStatusAdapterLike> = {}): ServerStatusAdapterLike {
  return {
    getServerHealth: async () => ({ tickHealth: "healthy" }),
    getServerStatus: async () => serverStatus,
    ...overrides,
  };
}

describe("ServerStatusService", () => {
  it("merges health and status into the contract's Status shape", async () => {
    const status = await new ServerStatusService(adapterWith()).getStatus();
    expect(status).toEqual({
      tickHealth: "healthy",
      sessionName: "my-save",
      isGameRunning: true,
      gamePaused: false,
      connectedPlayers: 2,
      playerLimit: 4,
      tickRate: 30,
      totalGameDurationSeconds: 100,
    });
    expect(StatusSchema.parse(status)).toEqual(status);
  });

  // Per docs-vault/raw-sources/dedicated-server-api.md:310, HealthCheck reports
  // "slow" below 10 ticks/s rather than failing, so it's a normal resolved value.
  it("passes a slow tick health through without throwing", async () => {
    const service = new ServerStatusService(adapterWith({ getServerHealth: async () => ({ tickHealth: "slow" }) }));
    await expect(service.getStatus()).resolves.toMatchObject({ tickHealth: "slow" });
  });

  it("maps the game's pause state to gamePaused (not a building's isPaused)", async () => {
    const service = new ServerStatusService(
      adapterWith({ getServerStatus: async () => ({ ...serverStatus, isPaused: true }) }),
    );
    await expect(service.getStatus()).resolves.toMatchObject({ gamePaused: true });
  });

  it("propagates a rejection from getServerHealth rather than swallowing it", async () => {
    const service = new ServerStatusService(
      adapterWith({
        getServerHealth: async () => {
          throw new Error("connect ECONNREFUSED");
        },
      }),
    );
    await expect(service.getStatus()).rejects.toThrow("connect ECONNREFUSED");
  });

  it("propagates a rejection from getServerStatus rather than swallowing it", async () => {
    const service = new ServerStatusService(
      adapterWith({
        getServerStatus: async () => {
          throw new Error("connect ECONNREFUSED");
        },
      }),
    );
    await expect(service.getStatus()).rejects.toThrow("connect ECONNREFUSED");
  });

  // Found by an independent CI review pass: getStatus used to build its return value
  // with a spread, which bypasses TypeScript's excess-property checking. A future
  // ServerStatus field must not leak into the response.
  it("does not leak an adapter-only field that isn't part of Status", async () => {
    const service = new ServerStatusService(
      adapterWith({
        getServerStatus: async () => ({ ...serverStatus, internalDebugFlag: true }) as ServerStatus,
      }),
    );
    const status = await service.getStatus();
    expect(status).not.toHaveProperty("internalDebugFlag");
    expect(Object.keys(status).sort()).toEqual(Object.keys(StatusSchema.shape).sort());
  });
});
